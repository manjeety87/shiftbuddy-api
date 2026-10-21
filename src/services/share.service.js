const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');

// "Let someone see my shifts." Every read of another person's schedule goes
// through viewableGrantWhere() — expiry, revocation and "is this really their
// email" are enforced here, on the server, so no client (mobile or web) can get
// it wrong.

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATION_DAYS = { week: 7, month: 30 };

const normalizeEmail = (email) => email.trim().toLowerCase();

const expiryFor = (duration) => (duration === 'forever' ? null : new Date(Date.now() + DURATION_DAYS[duration] * DAY_MS));

/** Not revoked and not past its end date. */
const activeWhere = () => ({
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
});

/** Grants addressed to this (verified) viewer: linked to their account, or still waiting on their email. */
const addressedTo = (viewer) => ({
    OR: [{ granteeId: viewer.id }, { granteeId: null, inviteEmail: viewer.email }],
});

/**
 * The grants `viewer` may use right now, or null when they may use none.
 *
 * - Only an account with a verified email can receive a share. Otherwise anyone
 *   could sign up with a friend's email first and read the schedule meant for them.
 * - An owner who asked to delete their account is hidden at once: their schedule
 *   stops showing, though the grant comes back if they restore the account.
 * - The conditions are joined with AND on purpose: two have their own `OR`,
 *   and spreading both into one object silently drops the first (it did — expired
 *   shares stayed readable).
 */
const viewableGrantWhere = (viewer, extra = {}) =>
    viewer.isEmailVerified ? { ...extra, AND: [activeWhere(), addressedTo(viewer), { owner: { deletionRequestedAt: null } }] } : null;

const getViewer = async (userId) => {
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isEmailVerified: true } });
    if (!viewer) throw new ApiError(401, 'User no longer exists');
    return viewer;
};

// What the owner sees in their list
const toOutgoing = (grant) => ({
    id: grant.id,
    email: grant.inviteEmail,
    name: grant.grantee?.name ?? null,
    status: grant.granteeId ? 'active' : 'pending', // pending = no verified account with that email yet
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
});

const listOutgoing = async (ownerId) => {
    const grants = await prisma.shareGrant.findMany({
        where: { ownerId, ...activeWhere() },
        include: { grantee: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
    });
    return grants.map(toOutgoing);
};

/** Share with an email for a week, a month, or until revoked. Sharing again with the same person updates the duration. */
const createShare = async (ownerId, { email, duration }) => {
    const inviteEmail = normalizeEmail(email);
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true } });
    if (!owner) throw new ApiError(401, 'User no longer exists');
    if (owner.email === inviteEmail) throw new ApiError(400, 'You can’t share your shifts with yourself');

    const account = await prisma.user.findUnique({ where: { email: inviteEmail }, select: { id: true, isEmailVerified: true } });
    // An account that never proved it owns this email isn't linked: the share waits
    const grantee = account?.isEmailVerified ? account : null;
    const expiresAt = expiryFor(duration);

    const existing = await prisma.shareGrant.findFirst({ where: { ownerId, inviteEmail, ...activeWhere() } });
    const grant = existing
        ? await prisma.shareGrant.update({
            where: { id: existing.id },
            data: { expiresAt, granteeId: existing.granteeId ?? grantee?.id ?? null },
            include: { grantee: { select: { name: true } } },
        })
        : await prisma.shareGrant.create({
            data: { ownerId, inviteEmail, granteeId: grantee?.id ?? null, expiresAt },
            include: { grantee: { select: { name: true } } },
        });
    return toOutgoing(grant);
};

/** Stop sharing. The owner can revoke; the viewer can also remove a share they no longer want. */
const revokeShare = async (userId, grantId) => {
    const viewer = await getViewer(userId);
    const asViewer = viewer.isEmailVerified ? [addressedTo(viewer)] : [];
    const grant = await prisma.shareGrant.findFirst({
        where: { id: grantId, revokedAt: null, OR: [{ ownerId: userId }, ...asViewer] },
        select: { id: true },
    });
    if (!grant) throw new ApiError(404, 'Share not found');
    await prisma.shareGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
};

/** People sharing their shifts with me. Links pending invites to my (verified) account as a side effect. */
const listIncoming = async (userId) => {
    const viewer = await getViewer(userId);
    const where = viewableGrantWhere(viewer, { ownerId: { not: userId } });
    if (!where) return [];

    const grants = await prisma.shareGrant.findMany({
        where,
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
    });

    const pendingIds = grants.filter((grant) => !grant.granteeId).map((grant) => grant.id);
    if (pendingIds.length) {
        await prisma.shareGrant.updateMany({ where: { id: { in: pendingIds } }, data: { granteeId: userId } });
    }

    // One entry per owner, keeping the longest-lasting grant
    const byOwner = new Map();
    for (const grant of grants) {
        const current = byOwner.get(grant.ownerId);
        const lastsLonger = !current || (current.expiresAt && (!grant.expiresAt || grant.expiresAt > current.expiresAt));
        if (lastsLonger) byOwner.set(grant.ownerId, grant);
    }
    return [...byOwner.values()].map((grant) => ({ id: grant.id, owner: grant.owner, expiresAt: grant.expiresAt }));
};

/** The one gate for reading someone else's schedule. 404 (not 403) so it doesn't reveal who exists. */
const assertCanView = async (viewerId, ownerId) => {
    const where = viewableGrantWhere(await getViewer(viewerId), { ownerId });
    const grant = where && viewerId !== ownerId ? await prisma.shareGrant.findFirst({ where, select: { id: true } }) : null;
    if (!grant) throw new ApiError(404, 'Schedule not found or no longer shared with you');
};

/** Another person's shifts, trimmed to what a viewer may see: times, workplace, role and colour. */
const getSharedShifts = async (viewerId, ownerId, { from, to }) => {
    await assertCanView(viewerId, ownerId);
    const [owner, shifts] = await Promise.all([
        prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true } }),
        prisma.shift.findMany({
            where: { userId: ownerId, startTime: { gte: from, lte: to } },
            select: { id: true, startTime: true, endTime: true, job: { select: { title: true, companyName: true, color: true } } },
            orderBy: { startTime: 'asc' },
        }),
    ]);
    return { owner, shifts };
};

module.exports = { listOutgoing, createShare, revokeShare, listIncoming, assertCanView, getSharedShifts };
