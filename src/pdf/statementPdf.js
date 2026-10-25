const PDFDocument = require('pdfkit');
const { DateTime } = require('luxon');

// Letter paper (Canada). Plain on purpose, like a bank's e-statement: black text,
// grey for the small print, thin rules under headings — no colour, no boxes.
const PAGE = { width: 612, height: 792, margin: 48 };
const WIDTH = PAGE.width - 2 * PAGE.margin;
const FOOTER_HEIGHT = 40;
const COLOR = { ink: '#000000', muted: '#555555', rule: '#bbbbbb' };

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const formatMoney = (value) => (value == null ? '-' : money.format(value));
// Decimal hours, the way pay stubs count them, so the two can be compared line by line
const formatHours = (minutes) => (minutes / 60).toFixed(2);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The statement (`domain/statement.js`) as a PDF: who and which days, a summary in
 * plain sentences, hours (and pay) by job, then every shift. Dates and times are in
 * the user's `timeZone`; `period` is { start, end } as ISO dates, both included.
 * Resolves to a Buffer.
 */
const renderStatementPdf = ({ statement, personName, scope, period, timeZone, preparedAt }) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'LETTER',
            margins: { top: PAGE.margin, bottom: PAGE.margin + FOOTER_HEIGHT, left: PAGE.margin, right: PAGE.margin },
            bufferPages: true,
            info: { Title: `Shift statement, ${period.start} to ${period.end}`, Author: 'ShiftBuddy' },
        });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const zoned = (date) => DateTime.fromJSDate(date, { zone: timeZone });
        const day = (iso) => DateTime.fromISO(iso, { zone: timeZone }).toFormat('LLLL d, yyyy');
        const left = PAGE.margin;
        const bottom = PAGE.height - PAGE.margin - FOOTER_HEIGHT;
        let y = PAGE.margin;

        const text = (value, x, top, { size = 10, bold = false, color = COLOR.ink, width, align = 'left' } = {}) =>
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(value, x, top, { width, align, lineBreak: false, ellipsis: true, height: size + 4 });
        const rule = (top) => doc.moveTo(left, top).lineTo(left + WIDTH, top).lineWidth(0.5).strokeColor(COLOR.rule).stroke();
        const roomFor = (height) => {
            if (y + height <= bottom) return;
            doc.addPage();
            y = PAGE.margin;
        };
        const heading = (label) => {
            roomFor(60);
            y += 14;
            text(label, left, y, { size: 12, bold: true });
            y += 18;
        };
        const paragraph = (value) => {
            doc.font('Helvetica').fontSize(10).fillColor(COLOR.ink);
            const height = doc.heightOfString(value, { width: WIDTH, lineGap: 2 });
            roomFor(height);
            doc.text(value, left, y, { width: WIDTH, lineGap: 2 });
            y += height + 4;
        };
        // A table: columns { label, width, align }; the header repeats on every page it runs onto
        const table = (columns, rows) => {
            const header = () => {
                let x = left;
                for (const column of columns) {
                    text(column.label, x, y, { size: 8.5, bold: true, width: column.width - 6, align: column.align });
                    x += column.width;
                }
                rule(y + 13);
                y += 18;
            };
            header();
            for (const row of rows) {
                if (y + 16 > bottom) {
                    doc.addPage();
                    y = PAGE.margin;
                    header();
                }
                if (row.total) rule(y - 3);
                let x = left;
                row.cells.forEach((cell, index) => {
                    const { width, align } = columns[index];
                    text(String(cell), x, y, { size: 9, bold: row.total, width: width - 6, align });
                    x += width;
                });
                y += 16;
            }
        };

        // Who, which days, which jobs
        const { showPay, totals, jobs, rows } = statement;
        text('ShiftBuddy', left, y, { size: 9, bold: true, color: COLOR.muted });
        y += 14;
        text('Shift statement', left, y, { size: 18, bold: true });
        y += 28;
        for (const line of [personName, `Period: ${day(period.start)} to ${day(period.end)}`, `Jobs: ${scope}`, `Prepared on ${zoned(preparedAt).toFormat('LLLL d, yyyy')}`]) {
            text(line, left, y, { size: 10 });
            y += 14;
        }
        y += 4;
        rule(y);

        // The summary, in sentences
        heading('Summary');
        if (rows.length === 0) {
            paragraph('No finished shifts in this period.');
        } else {
            paragraph(`You worked ${plural(totals.shiftCount, 'shift')} at ${plural(jobs.length, 'job')}: ${formatHours(totals.paidMinutes)} hours in total, after unpaid breaks.`);
            if (totals.grossPay != null) {
                const after = totals.takeHome != null && statement.taxDeductionPercent > 0 ? `, about ${formatMoney(totals.takeHome)} after your ${statement.taxDeductionPercent}% deduction` : '';
                paragraph(`Estimated pay: ${formatMoney(totals.grossPay)} before deductions${after}.`);
            }
            if (totals.missingRates) paragraph('Some jobs have no hourly rate, so their hours are not in the pay estimate.');
            if (totals.scheduledCount > 0) paragraph(`${plural(totals.scheduledCount, 'shift')} had no clocked hours, so the scheduled times are used (marked "Schedule" below).`);
        }

        if (rows.length > 0) {
            // Hours (and pay) by job
            heading('By job');
            const jobColumns = showPay
                ? [{ label: 'Job', width: 150 }, { label: 'Title', width: 120 }, { label: 'Shifts', width: 50, align: 'right' }, { label: 'Hours', width: 56, align: 'right' }, { label: 'Rate', width: 64, align: 'right' }, { label: 'Pay', width: 76, align: 'right' }]
                : [{ label: 'Job', width: 200 }, { label: 'Title', width: 180 }, { label: 'Shifts', width: 60, align: 'right' }, { label: 'Hours', width: 76, align: 'right' }];
            const jobRows = jobs.map((job) => ({
                cells: showPay
                    ? [job.name, job.role ?? '-', job.shiftCount, formatHours(job.paidMinutes), job.hourlyRate == null ? 'Not set' : formatMoney(job.hourlyRate), formatMoney(job.grossPay)]
                    : [job.name, job.role ?? '-', job.shiftCount, formatHours(job.paidMinutes)],
            }));
            if (jobs.length > 1) {
                jobRows.push({
                    total: true,
                    cells: showPay ? ['Total', '', totals.shiftCount, formatHours(totals.paidMinutes), '', formatMoney(totals.grossPay)] : ['Total', '', totals.shiftCount, formatHours(totals.paidMinutes)],
                });
            }
            table(jobColumns, jobRows);

            // Every shift, oldest first
            heading('Shifts');
            const timeOf = (date) => zoned(date).toFormat('h:mm a');
            const endOf = (row) => `${timeOf(row.end)}${zoned(row.end).hasSame(zoned(row.start), 'day') ? '' : ' +1'}`;
            table(
                [{ label: 'Date', width: 96 }, { label: 'Job', width: 96 }, { label: 'Title', width: 84 }, { label: 'Start', width: 52 }, { label: 'End', width: 62 }, { label: 'Break', width: 44, align: 'right' }, { label: 'Hours', width: 36, align: 'right' }, { label: 'From', width: 46, align: 'right' }],
                rows.map((row) => ({
                    cells: [zoned(row.start).toFormat('ccc, LLL d, yyyy'), row.jobName, row.role ?? '-', timeOf(row.start), endOf(row), row.breakMinutes ? `${row.breakMinutes} min` : '-', formatHours(row.paidMinutes), row.source === 'clocked' ? 'Clocked' : 'Schedule'],
                })),
            );
        }

        // On every page: what this is (and isn't), and the page number
        const { start, count } = doc.bufferedPageRange();
        for (let index = start; index < start + count; index++) {
            doc.switchToPage(index);
            const footerY = PAGE.height - PAGE.margin - 20;
            doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
            rule(footerY - 8);
            doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.muted).text(
                'Made from the shifts and hours in ShiftBuddy. Not an official pay stub: your employer’s may also show stat holiday pay, vacation pay, CPP, EI and income tax.',
                left,
                footerY,
                { width: WIDTH - 90, lineGap: 2 },
            );
            text(`Page ${index - start + 1} of ${count}`, left + WIDTH - 80, footerY, { size: 7.5, color: COLOR.muted, width: 80, align: 'right' });
        }
        doc.end();
    });

module.exports = { renderStatementPdf };
