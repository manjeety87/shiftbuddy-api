const PDFDocument = require('pdfkit');
const { DateTime } = require('luxon');

// Letter paper (Canada), the app's calm palette: ink, a muted grey, hairlines and the sage accent
const PAGE = { width: 612, height: 792, margin: 48 };
const WIDTH = PAGE.width - 2 * PAGE.margin;
const FOOTER_HEIGHT = 44;
const COLOR = { ink: '#23201c', muted: '#6f6a63', rule: '#e4dfd6', soft: '#f6f3ee', accent: '#527558' };

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const formatMoney = (value) => (value == null ? '—' : money.format(value));
// Decimal hours, the way pay stubs count them, so the two can be compared line by line
const formatHours = (minutes) => (minutes / 60).toFixed(2);

/**
 * The statement (`domain/statement.js`) as a PDF: a header with the period, three
 * figures, hours (and pay) by job, the deduction estimate, then every shift with
 * its job, title and times. Dates and times are in the user's `timeZone`; `period`
 * is { start, end } as ISO dates, both included. Resolves to a Buffer.
 */
const renderStatementPdf = ({ statement, personName, scope, period, timeZone, preparedAt }) =>
    new Promise((resolve, reject) => {
        const { showPay, totals, jobs, rows } = statement;
        const title = showPay ? 'Hours & Pay Statement' : 'Hours Statement';
        const doc = new PDFDocument({
            size: 'LETTER',
            margins: { top: PAGE.margin, bottom: PAGE.margin + FOOTER_HEIGHT, left: PAGE.margin, right: PAGE.margin },
            bufferPages: true,
            info: { Title: `${title}, ${period.start} to ${period.end}`, Author: 'ShiftBuddy' },
        });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const zoned = (date) => DateTime.fromJSDate(date, { zone: timeZone });
        const startDay = DateTime.fromISO(period.start, { zone: timeZone });
        const endDay = DateTime.fromISO(period.end, { zone: timeZone });
        // The year is said once in the header, unless the statement runs across two
        const acrossYears = startDay.year !== endDay.year;
        const left = PAGE.margin;
        const bottom = PAGE.height - PAGE.margin - FOOTER_HEIGHT;

        const text = (value, x, y, { size = 10, font = 'Helvetica', color = COLOR.ink, width, align = 'left', spacing = 0 } = {}) =>
            doc.font(font).fontSize(size).fillColor(color).text(value, x, y, { width, align, characterSpacing: spacing, lineBreak: false, ellipsis: width ? true : undefined, height: width ? size + 4 : undefined });
        const rule = (y, color = COLOR.rule) => doc.moveTo(left, y).lineTo(left + WIDTH, y).lineWidth(0.75).strokeColor(color).stroke();
        const sectionTitle = (label, y) => text(label, left, y, { size: 12, font: 'Helvetica-Bold' });

        // A table: columns { label, width, align }, header on every page it runs onto
        const table = (columns, tableRows, startY, { rowHeight = 22, zebra = false } = {}) => {
            const header = (y) => {
                let x = left;
                for (const column of columns) {
                    text(column.label.toUpperCase(), x + 6, y, { size: 7.5, font: 'Helvetica-Bold', color: COLOR.muted, width: column.width - 12, align: column.align, spacing: 0.4 });
                    x += column.width;
                }
                rule(y + 13);
                return y + 19;
            };
            let y = header(startY);
            tableRows.forEach((row, index) => {
                const height = row.height ?? rowHeight;
                if (y + height > bottom) {
                    doc.addPage();
                    y = header(PAGE.margin);
                }
                if (row.total) rule(y - 3, COLOR.muted);
                else if (zebra && index % 2 === 1) doc.rect(left, y - 4, WIDTH, height).fill(COLOR.soft);
                let x = left;
                row.cells.forEach((cell, i) => {
                    const { width, align } = columns[i];
                    const { value, sub } = typeof cell === 'object' && cell !== null ? cell : { value: cell };
                    text(String(value), x + 6, y + 2, { size: 9.5, font: row.total ? 'Helvetica-Bold' : 'Helvetica', width: width - 12, align });
                    if (sub) text(sub, x + 6, y + 14, { size: 8, color: COLOR.muted, width: width - 12, align });
                    x += width;
                });
                y += height;
            });
            return y;
        };

        // Header: what, for whom, which days
        text('SHIFTBUDDY', left, PAGE.margin, { size: 8.5, font: 'Helvetica-Bold', color: COLOR.accent, spacing: 1.4 });
        text(title, left, PAGE.margin + 14, { size: 20, font: 'Helvetica-Bold' });
        text(personName, left, PAGE.margin + 42, { size: 10 });
        text(scope, left, PAGE.margin + 56, { size: 9, color: COLOR.muted });

        const right = { x: left + WIDTH - 230, width: 230, align: 'right' };
        text('PERIOD', right.x, PAGE.margin, { ...right, size: 7.5, font: 'Helvetica-Bold', color: COLOR.muted, spacing: 0.4 });
        text(`${startDay.toFormat(acrossYears ? 'LLL d, yyyy' : 'LLL d')} – ${endDay.toFormat('LLL d, yyyy')}`, right.x, PAGE.margin + 12, { ...right, size: 11, font: 'Helvetica-Bold' });
        text(`Prepared ${zoned(preparedAt).toFormat('LLL d, yyyy')}`, right.x, PAGE.margin + 28, { ...right, size: 9, color: COLOR.muted });
        rule(PAGE.margin + 76);

        // Three figures
        const figures = showPay
            ? [['Hours worked', formatHours(totals.paidMinutes)], ['Gross pay', formatMoney(totals.grossPay)], ['Take-home (estimate)', formatMoney(totals.takeHome)]]
            : [['Hours worked', formatHours(totals.paidMinutes)], ['Shifts worked', String(totals.shiftCount)], ['Jobs', String(jobs.length)]];
        const gap = 10;
        const tile = (WIDTH - 2 * gap) / 3;
        const tileY = PAGE.margin + 92;
        figures.forEach(([label, value], index) => {
            const x = left + index * (tile + gap);
            doc.roundedRect(x, tileY, tile, 56, 6).fill(COLOR.soft);
            text(label.toUpperCase(), x + 12, tileY + 12, { size: 7.5, font: 'Helvetica-Bold', color: COLOR.muted, width: tile - 24, spacing: 0.4 });
            text(value, x + 12, tileY + 27, { size: 17, font: 'Helvetica-Bold', width: tile - 24 });
        });

        let y = tileY + 82;
        if (rows.length === 0) {
            text('No finished shifts in this period.', left, y, { size: 10, color: COLOR.muted });
        } else {
            // Hours (and pay) by job
            sectionTitle('Hours by job', y);
            const jobCell = (job) => ({ value: job.name, sub: job.role ?? undefined });
            const jobColumns = showPay
                ? [{ label: 'Job', width: 216 }, { label: 'Shifts', width: 60, align: 'right' }, { label: 'Rate', width: 76, align: 'right' }, { label: 'Hours', width: 70, align: 'right' }, { label: 'Amount', width: 94, align: 'right' }]
                : [{ label: 'Job', width: 276 }, { label: 'Shifts', width: 120, align: 'right' }, { label: 'Hours', width: 120, align: 'right' }];
            const jobRows = jobs.map((job) => ({
                height: job.role ? 30 : 22,
                cells: showPay
                    ? [jobCell(job), job.shiftCount, job.hourlyRate == null ? '—' : formatMoney(job.hourlyRate), formatHours(job.paidMinutes), formatMoney(job.grossPay)]
                    : [jobCell(job), job.shiftCount, formatHours(job.paidMinutes)],
            }));
            if (jobs.length > 1) {
                jobRows.push({
                    total: true,
                    cells: showPay ? ['Total', totals.shiftCount, '', formatHours(totals.paidMinutes), formatMoney(totals.grossPay)] : ['Total', totals.shiftCount, formatHours(totals.paidMinutes)],
                });
            }
            y = table(jobColumns, jobRows, y + 22);

            // Gross → the user's own deduction estimate → take-home, with what the numbers leave out beside it
            const percent = statement.taxDeductionPercent;
            const notes = [
                showPay && 'Pay uses each job’s hourly rate as it is set in ShiftBuddy now.',
                totals.missingRates && 'Jobs without an hourly rate show hours only; add a rate to include them.',
                showPay && (percent > 0 ? 'Deductions are the one percentage you set in Settings › Pay, not a tax calculation.' : 'Set a deduction percentage in Settings › Pay for a take-home estimate.'),
                totals.scheduledCount > 0 && `${totals.scheduledCount === 1 ? 'One shift has' : `${totals.scheduledCount} shifts have`} no clocked hours, so the scheduled times are used (“Schedule” below).`,
            ].filter(Boolean);
            const box = { x: left + WIDTH - 236, width: 236 };
            if (showPay || notes.length > 0) {
                y += 14;
                if (y + 70 > bottom) {
                    doc.addPage();
                    y = PAGE.margin;
                }
                if (showPay) {
                    const line = (label, value, offset, bold = false) => {
                        text(label, box.x, y + offset, { size: 9.5, font: bold ? 'Helvetica-Bold' : 'Helvetica', width: 150 });
                        text(value, box.x + 150, y + offset, { size: 9.5, font: bold ? 'Helvetica-Bold' : 'Helvetica', width: 86, align: 'right' });
                    };
                    line('Gross pay', formatMoney(totals.grossPay), 0);
                    line(percent > 0 ? `Deductions (${percent}%, your estimate)` : 'Deductions (none set)', totals.deductions ? `– ${formatMoney(totals.deductions)}` : '—', 16);
                    doc.moveTo(box.x, y + 33).lineTo(box.x + box.width, y + 33).lineWidth(0.75).strokeColor(COLOR.muted).stroke();
                    line('Take-home (estimate)', formatMoney(totals.takeHome), 39, true);
                }
                const notesWidth = showPay ? WIDTH - box.width - 30 : WIDTH;
                doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted).text(notes.join('\n'), left, y, { width: notesWidth, lineGap: 3 });
                // Below whichever is taller: the notes or the deduction box
                y += Math.max(showPay ? 56 : 0, doc.heightOfString(notes.join('\n'), { width: notesWidth, lineGap: 3 })) + 10;
            }

            // Every shift, oldest first: job with its title under it, the times, and where the hours came from
            y += 10;
            if (y + 60 > bottom) {
                doc.addPage();
                y = PAGE.margin;
            }
            sectionTitle('Every shift', y);
            const timeOf = (date) => zoned(date).toFormat('h:mm a');
            const endOf = (row) => `${timeOf(row.end)}${zoned(row.end).hasSame(zoned(row.start), 'day') ? '' : ' +1'}`;
            table(
                [{ label: 'Date', width: 88 }, { label: 'Job', width: 140 }, { label: 'In', width: 60, align: 'right' }, { label: 'Out', width: 76, align: 'right' }, { label: 'Break', width: 48, align: 'right' }, { label: 'Hours', width: 44, align: 'right' }, { label: 'From', width: 60, align: 'right' }],
                rows.map((row) => ({
                    height: row.role ? 30 : 22,
                    cells: [
                        zoned(row.start).toFormat(acrossYears ? 'LLL d, yyyy' : 'ccc, LLL d'),
                        { value: row.jobName, sub: row.role ?? undefined },
                        timeOf(row.start),
                        endOf(row),
                        row.breakMinutes ? `${row.breakMinutes} min` : '—',
                        formatHours(row.paidMinutes),
                        row.source === 'clocked' ? 'Clock' : 'Schedule',
                    ],
                })),
                y + 22,
                { zebra: true },
            );
        }

        // On every page: what this is (and isn't), and the page number
        const { start, count } = doc.bufferedPageRange();
        for (let index = start; index < start + count; index++) {
            doc.switchToPage(index);
            const footerY = PAGE.height - PAGE.margin - 22;
            doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
            rule(footerY - 8);
            doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.muted).text(
                'An estimate from the shifts and hours in ShiftBuddy — not an official pay stub. Your employer’s stub may also show stat holiday pay, vacation pay, CPP, EI and income tax.',
                left,
                footerY,
                { width: WIDTH - 90, lineGap: 2 },
            );
            text(`Page ${index - start + 1} of ${count}`, left + WIDTH - 80, footerY, { size: 7.5, color: COLOR.muted, width: 80, align: 'right' });
        }
        doc.end();
    });

module.exports = { renderStatementPdf };
