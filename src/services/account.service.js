const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { endAllSessionsQuery } = require('./session.service');
const { toPublicUser } = require('./auth.service');
const { sendDeletionScheduledEmail } = require('./email.service');
const { DELETE_CONFIRMATION, DELETION_GRACE_DAYS, purgeDateFor, purgeCutoff, describeDevice } = require('../domain/account');

// The account as a whole: where it is signed in, a copy of everything in it, and
// deleting it (with a grace period to change your mind). Signing in and tokens
// stay in auth.service / session.service.

const HOUR_MS = 60 * 60 * 1000;

// ─── Where you're signed in ───────────────────────────────────────────────

/** Every device signed in to this account, this one first, then the most recently used. */
const listSessions = async (userId, currentSessionId) => {
    const sessions = await prisma.session.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true },
        orderBy: { lastUsedAt: 'desc' },
    });
    return sessions
        .map(({ userAgent, ...session }) => ({ ...session, device: describeDevice(userAgent), isCurrent: session.id === currentSessionId }))
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
};

/** Signs one other device out. This device signs out with /auth/logout, so the client can clear itself too. */
const endSessionOf = async (userId, sessionId, currentSessionId) => {
    if (sessionId === currentSessionId) throw new ApiError(400, 'That’s this device — use Log out instead', { code: 'CURRENT_SESSION' });
    const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
    if (count === 0) throw new ApiError(404, 'That device is already signed out');
};

/** Signs every device out except this one. Returns how many were signed out. */
const endOtherSessions = async (userId, currentSessionId) => {
    const { count } = await prisma.session.deleteMany({ where: { userId, ...(currentSessionId && { id: { not: currentSessionId } }) } });
    // The old single token (phones from before sessions) is "another device" too
    await prisma.user.update({ where: { id: userId }, data: { refreshToken: null } });
    return { signedOut: count };
};

// ─── Your data ────────────────────────────────────────────────────────────

/**
 * Everything the account holds, in one JSON document people can keep. Ids are
 * kept so shifts and hours can be matched to their job; secrets (password and
 * token hashes, one-time codes) never leave the database.
 */
const exportAccount = async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(401, 'User no longer exists');

    const [jobs, shifts, timeEntries, sharesGiven, sharesReceived] = await Promise.all([
        prisma.job.findMany({ where: { userId }, omit: { userId: true }, orderBy: { createdAt: 'asc' } }),
        prisma.shift.findMany({ where: { userId }, omit: { userId: true }, orderBy: { startTime: 'asc' } }),
        prisma.timeEntry.findMany({ where: { userId }, omit: { userId: true }, orderBy: { clockIn: 'asc' } }),
        prisma.shareGrant.findMany({
            where: { ownerId: userId },
            select: { inviteEmail: true, expiresAt: true, revokedAt: true, createdAt: true, grantee: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.shareGrant.findMany({
            where: { granteeId: userId },
            select: { expiresAt: true, revokedAt: true, createdAt: true, owner: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'asc' },
        }),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        format: 'ShiftBuddy data export, version 1. Times are UTC (ISO 8601).',
        account: { ...toPublicUser(user), createdAt: user.createdAt },
        jobs,
        shifts,
        timeEntries,
        sharing: {
            withOthers: sharesGiven.map(({ inviteEmail, grantee, ...grant }) => ({ email: inviteEmail, name: grantee?.name ?? null, ...grant })),
            withMe: sharesReceived.map(({ owner, ...grant }) => ({ name: owner.name, email: owner.email, ...grant })),
        },
    };
};

/** How much is in the account — said in words before someone deletes it. */
const accountSummary = async (userId) => {
    const [jobs, shifts, timeEntries, shares] = await Promise.all([
        prisma.job.count({ where: { userId } }),
        prisma.shift.count({ where: { userId } }),
        prisma.timeEntry.count({ where: { userId } }),
        prisma.shareGrant.count({ where: { ownerId: userId, revokedAt: null } }),
    ]);
    return { jobs, shifts, timeEntries, shares, graceDays: DELETION_GRACE_DAYS };
};

// ─── Deleting the account ─────────────────────────────────────────────────

/**
 * Asks for the account to be deleted. Someone at an unlocked computer mustn't be
 * able to do it, so a password account confirms with its password and a Google /
 * Apple one types DELETE. It is then signed out everywhere and hidden at once
 * (shares stop showing, sign-in offers a restore); the data is erased after the
 * grace period by `purgeExpiredAccounts`.
 */
const requestDeletion = async (userId, { password, confirm }) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(401, 'User no longer exists');

    if (user.password) {
        if (!password) throw new ApiError(400, 'Enter your password to delete your account', { code: 'PASSWORD_REQUIRED' });
        if (!(await bcrypt.compare(password, user.password))) throw new ApiError(401, 'Incorrect password', { code: 'WRONG_PASSWORD' });
    } else if (confirm !== DELETE_CONFIRMATION) {
        throw new ApiError(400, `Type ${DELETE_CONFIRMATION} to confirm`, { code: 'CONFIRMATION_REQUIRED' });
    }

    const requestedAt = new Date();
    await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { deletionRequestedAt: requestedAt, refreshToken: null } }),
        endAllSessionsQuery(userId),
    ]);

    const purgeAt = purgeDateFor(requestedAt);
    // The request stands even if the email fails; signing in still offers the restore
    sendDeletionScheduledEmail(user.email, purgeAt).catch((err) => console.error('Deletion email not sent:', err.message));
    return { purgeAt };
};

/** Erases accounts past their grace period. Jobs, shifts, hours, sessions and shares cascade from the user row. */
const purgeExpiredAccounts = async () => {
    const { count } = await prisma.user.deleteMany({ where: { deletionRequestedAt: { lt: purgeCutoff() } } });
    if (count) console.log(`🗑️  Erased ${count} account(s) past the ${DELETION_GRACE_DAYS}-day grace period`);
    return count;
};

/**
 * Runs the purge at start and every hour. Safe with more than one server: a
 * delete of rows that are already gone just deletes nothing.
 */
const schedulePurge = () => {
    const run = () => purgeExpiredAccounts().catch((err) => console.error('Account purge failed:', err.message));
    run();
    setInterval(run, HOUR_MS).unref();
};

module.exports = { listSessions, endSessionOf, endOtherSessions, exportAccount, accountSummary, requestDeletion, purgeExpiredAccounts, schedulePurge };
