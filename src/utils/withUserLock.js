const prisma = require('../config/prisma');

/**
 * Runs `work(tx)` in a transaction that only one request per user can be in at
 * a time. For anything that is "check, then save" (is this time free? am I
 * already clocked in?) — without it, two requests arriving together (a double
 * tap, the phone and the web app) both pass the check and both save. The lock is
 * released when the transaction ends.
 */
const withUserLock = (userId, work) =>
    prisma.$transaction(
        async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
            return work(tx);
        },
        { timeout: 15000 }
    );

module.exports = { withUserLock };
