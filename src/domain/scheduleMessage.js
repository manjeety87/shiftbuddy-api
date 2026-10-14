const { DateTime } = require('luxon');
const { jobName } = require('./jobLabels');

// Turns a stretch of shifts into a plain-text message for WhatsApp/SMS:
//   My shifts · Oct 5 – 11
//   Mon, Oct 5: 9 AM – 5 PM Boathouse · 5:30 – 9 PM Fairweather
//   Tue, Oct 6: Off
//
//   Total: 34.5h
// Days and times are in the user's time zone, so a 9 PM shift never lands on
// the wrong day and DST weeks still read correctly. No database here.

/** First day (local midnight) and length of a named range. Weeks start on Sunday, like the app's calendar. */
const rangeIn = (range, zone, now = DateTime.now()) => {
    const today = now.setZone(zone).startOf('day');
    if (range === 'thisMonth') {
        const start = today.startOf('month');
        return { start, days: start.daysInMonth };
    }
    const sunday = today.minus({ days: today.weekday % 7 }); // luxon: Monday = 1 … Sunday = 7
    return { start: range === 'nextWeek' ? sunday.plus({ weeks: 1 }) : sunday, days: 7 };
};

/** "9", "5:30", with " AM"/" PM" when asked */
const clock = (dt, withMeridiem) => {
    const hours12 = dt.hour % 12 || 12;
    const time = dt.minute === 0 ? `${hours12}` : `${hours12}:${String(dt.minute).padStart(2, '0')}`;
    return withMeridiem ? `${time} ${dt.hour < 12 ? 'AM' : 'PM'}` : time;
};

/** "9 AM – 5 PM", "5:30 – 9 PM" (shared AM/PM said once), "10 PM – 6 AM" */
const compactTimeRange = (start, end) => {
    const sameMeridiem = start.hour < 12 === end.hour < 12 && start.hasSame(end, 'day');
    return `${clock(start, !sameMeridiem)} – ${clock(end, true)}`;
};

const rangeLabel = (start, last) => `${start.toFormat('LLL d')} – ${start.hasSame(last, 'month') ? last.day : last.toFormat('LLL d')}`;

const formatHours = (minutes) => `${Math.round((minutes / 60) * 10) / 10}h`;

/** The message text for `shifts` (each with its job) over `days` days from `start` (a luxon DateTime). */
const buildScheduleMessage = (shifts, { start, days, nameStyle, includeDaysOff }) => {
    const zone = start.zone;
    const local = (date) => DateTime.fromJSDate(date, { zone });
    const lines = [`My shifts · ${rangeLabel(start, start.plus({ days: days - 1 }))}`];
    let totalMinutes = 0;

    for (let i = 0; i < days; i++) {
        const day = start.plus({ days: i });
        // A shift belongs to the day it starts on (an overnight shift is listed once)
        const dayShifts = shifts.filter((s) => local(s.startTime).hasSame(day, 'day')).sort((a, b) => a.startTime - b.startTime);

        if (dayShifts.length === 0) {
            if (includeDaysOff) lines.push(`${day.toFormat('ccc, LLL d')}: Off`);
            continue;
        }
        const parts = dayShifts.map((s) => {
            totalMinutes += Math.round((s.endTime - s.startTime) / 60000);
            const name = nameStyle === 'workplace' ? jobName(s.job) : s.job.title;
            return `${compactTimeRange(local(s.startTime), local(s.endTime))} ${name}`;
        });
        lines.push(`${day.toFormat('ccc, LLL d')}: ${parts.join(' · ')}`);
    }

    if (totalMinutes === 0) lines.push('No shifts — I’m free!');
    else lines.push('', `Total: ${formatHours(totalMinutes)}`);
    return { message: lines.join('\n'), totalMinutes };
};

module.exports = { rangeIn, buildScheduleMessage };
