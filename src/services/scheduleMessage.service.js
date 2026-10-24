const prisma = require('../config/prisma');
const { NOT_MISSED } = require('../constants/shifts');
const { rangeIn, buildScheduleMessage } = require('../domain/scheduleMessage');

/** The user's schedule message for a named range, in their time zone (sent by the client). */
const getScheduleMessage = async (userId, { range, nameStyle, includeDaysOff, timeZone }) => {
    const { start, days } = rangeIn(range, timeZone);
    const shifts = await prisma.shift.findMany({
        where: { userId, ...NOT_MISSED, startTime: { gte: start.toJSDate(), lt: start.plus({ days }).toJSDate() } },
        include: { job: true },
        orderBy: { startTime: 'asc' },
    });
    const { message, totalMinutes } = buildScheduleMessage(shifts, { start, days, nameStyle, includeDaysOff });
    return { message, shiftCount: shifts.length, totalMinutes, startDate: start.toISODate(), days };
};

module.exports = { getScheduleMessage };
