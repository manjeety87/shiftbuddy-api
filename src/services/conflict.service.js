const prisma = require('../config/prisma');
const { findOverlapPairs } = require('../domain/shifts');
const { findTravelConflicts } = require('./travelConflict.service');

// Every schedule problem in one answer, so Home (and the web app) show the same list:
// shifts that overlap, and back-to-back shifts you can't travel between in time.

/** Overlaps from `from` on (default: now, including a shift in progress), plus travel conflicts in the window. */
const findConflicts = async (userId, { from, to } = {}) => {
    const windowStart = from ?? new Date();
    const [shifts, travel] = await Promise.all([
        prisma.shift.findMany({
            where: { userId, endTime: { gt: windowStart }, ...(to && { startTime: { lt: to } }) },
            include: { job: true },
            orderBy: { startTime: 'asc' },
        }),
        findTravelConflicts(userId, { from, to }),
    ]);

    return { overlaps: findOverlapPairs(shifts), travel: travel.conflicts, mode: travel.mode };
};

module.exports = { findConflicts };
