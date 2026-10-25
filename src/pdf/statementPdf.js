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
 * figures, hours (and pay) by job with the year so far, the deduction estimate,
 * then every entry. Dates and times are in the user's `timeZone`. Resolves to a Buffer.
 */
const renderStatementPdf = ({ statement, personName, scope, period, payday, timeZone, preparedAt }) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'LETTER',
            margins: { top: PAGE.margin, bottom: PAGE.margin + FOOTER_HEIGHT, left: PAGE.margin, right: PAGE.margin },
            bufferPages: true,
            info: { Title: `${statement.showPay ? 'Hours & pay' : 'Hours'} statement, ${period.start} to ${period.end}`, Author: 'ShiftBuddy' },
        });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const zoned = (date) => DateTime.fromJSDate(date, { zone: timeZone });
        const day = (iso, format = 'LLL d, yyyy') => DateTime.fromISO(iso, { zone: timeZone }).toFormat(format);
        const left = PAGE.margin;
        const bottom = PAGE.height - PAGE.margin - FOOTER_HEIGHT;

        const text = (value, x, y, { size = 10, font = 'Helvetica', color = COLOR.ink, width, align = 'left', spacing = 0 } = {}) =>
            doc.font(font).fontSize(size).fillColor(color).text(value, x, y, { width, align, characterSpacing: spacing, lineBreak: false });
        const rule = (y, color = COLOR.rule) => doc.moveTo(left, y).lineTo(left + WIDTH, y).lineWidth(0.75).strokeColor(color).stroke();
        const sectionTitle = (label, y) => text(label, left, y, { size: 12, font: 'Helvetica-Bold' });

        // A table: columns { label, width, align }, header on every page it runs onto
        const table = (columns, rows, startY, { rowHeight = 22, zebra = false } = {}) => {
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
            rows.forEach((row, index) => {
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
        const { showPay, totals } = statement;
        text('SHIFTBUDDY', left, PAGE.margin, { size: 8.5, font: 'Helvetica-Bold', color: COLOR.accent, spacing: 1.4 });
        text(showPay ? 'Hours & Pay Statement' : 'Hours Statement', left, PAGE.margin + 14, { size: 20, font: 'Helvetica-Bold' });
        text(personName, left, PAGE.margin + 42, { size: 10 });
        text(scope, left, PAGE.margin + 56, { size: 9, color: COLOR.muted });

        const right = { x: left + WIDTH - 230, width: 230, align: 'right' };
        text('PERIOD', right.x, PAGE.margin, { ...right, size: 7.5, font: 'Helvetica-Bold', color: COLOR.muted, spacing: 0.4 });
        text(`${day(period.start, 'LLL d')} – ${day(period.end)}`, right.x, PAGE.margin + 12, { ...right, size: 11, font: 'Helvetica-Bold' });
        const meta = [payday && `Payday ${day(payday, 'ccc, LLL d, yyyy')}`, `Prepared ${zoned(preparedAt).toFormat('LLL d, yyyy')}`].filter(Boolean);
        meta.forEach((line, index) => text(line, right.x, PAGE.margin + 28 + index * 13, { ...right, size: 9, color: COLOR.muted }));
        rule(PAGE.margin + 76);

        // Three figures
        const figures = showPay
            ? [['Hours worked', formatHours(totals.paidMinutes)], ['Gross pay', formatMoney(totals.grossPay)], ['Take-home (estimate)', formatMoney(totals.takeHome)]]
            : [['Hours worked', formatHours(totals.paidMinutes)], ['Shifts worked', String(totals.entryCount)], ['Unpaid breaks', `${formatHours(totals.breakMinutes)} h`]];
        const gap = 10;
        const tile = (WIDTH - 2 * gap) / 3;
        const tileY = PAGE.margin + 92;
        figures.forEach(([label, value], index) => {
            const x = left + index * (tile + gap);
            doc.roundedRect(x, tileY, tile, 56, 6).fill(COLOR.soft);
            text(label.toUpperCase(), x + 12, tileY + 12, { size: 7.5, font: 'Helvetica-Bold', color: COLOR.muted, width: tile - 24, spacing: 0.4 });
            text(value, x + 12, tileY + 27, { size: 17, font: 'Helvetica-Bold', width: tile - 24 });
        });

        // Hours (and pay) by job, with the year so far
        let y = tileY + 82;
        sectionTitle('Hours by job', y);
        // The year so far, January 1 to the period's end — what a stub calls year to date
        const year = day(period.end, 'yyyy');
        const jobCell = (job) => ({ value: job.name, sub: job.role ?? undefined });
        const jobColumns = showPay
            ? [{ label: 'Job', width: 176 }, { label: 'Rate', width: 64, align: 'right' }, { label: 'Hours', width: 58, align: 'right' }, { label: 'Amount', width: 76, align: 'right' }, { label: `${year} hours`, width: 70, align: 'right' }, { label: `${year} pay`, width: 72, align: 'right' }]
            : [{ label: 'Job', width: 236 }, { label: 'Shifts', width: 70, align: 'right' }, { label: 'Hours', width: 90, align: 'right' }, { label: `${year} hours`, width: 120, align: 'right' }];
        const jobRows = statement.jobs.map((job) => ({
            height: job.role ? 30 : 22,
            cells: showPay
                ? [jobCell(job), job.hourlyRate == null ? '—' : formatMoney(job.hourlyRate), formatHours(job.paidMinutes), formatMoney(job.grossPay), formatHours(job.year.paidMinutes), formatMoney(job.year.grossPay)]
                : [jobCell(job), job.entryCount, formatHours(job.paidMinutes), formatHours(job.year.paidMinutes)],
        }));
        if (statement.jobs.length > 1) {
            jobRows.push({
                total: true,
                cells: showPay
                    ? ['Total', '', formatHours(totals.paidMinutes), formatMoney(totals.grossPay), formatHours(totals.year.paidMinutes), formatMoney(totals.year.grossPay)]
                    : ['Total', totals.entryCount, formatHours(totals.paidMinutes), formatHours(totals.year.paidMinutes)],
            });
        }
        y = table(jobColumns, jobRows, y + 22);

        // Gross → the user's own deduction estimate → take-home, with what the numbers leave out beside it
        if (showPay) {
            y += 14;
            if (y + 70 > bottom) {
                doc.addPage();
                y = PAGE.margin;
            }
            const box = { x: left + WIDTH - 236, width: 236 };
            const line = (label, value, offset, bold = false) => {
                text(label, box.x, y + offset, { size: 9.5, font: bold ? 'Helvetica-Bold' : 'Helvetica', width: 150 });
                text(value, box.x + 150, y + offset, { size: 9.5, font: bold ? 'Helvetica-Bold' : 'Helvetica', width: 86, align: 'right' });
            };
            const percent = statement.taxDeductionPercent;
            line('Gross pay', formatMoney(totals.grossPay), 0);
            line(percent > 0 ? `Deductions (${percent}%, your estimate)` : 'Deductions (none set)', totals.deductions ? `– ${formatMoney(totals.deductions)}` : '—', 16);
            doc.moveTo(box.x, y + 33).lineTo(box.x + box.width, y + 33).lineWidth(0.75).strokeColor(COLOR.muted).stroke();
            line('Take-home (estimate)', formatMoney(totals.takeHome), 39, true);

            const notes = [
                'Pay uses each job’s hourly rate as it is set in ShiftBuddy now.',
                totals.missingRates && 'Jobs without an hourly rate show hours only; add a rate to include them.',
                percent > 0 ? 'Deductions are the one percentage you set in Settings › Pay, not a tax calculation.' : 'Set a deduction percentage in Settings › Pay for a take-home estimate.',
            ].filter(Boolean);
            doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted).text(notes.join('\n'), left, y, { width: WIDTH - box.width - 30, lineGap: 3 });
            y += 66;
        }

        // Every entry, oldest first
        y += 10;
        if (y + 60 > bottom) {
            doc.addPage();
            y = PAGE.margin;
        }
        sectionTitle('Every shift', y);
        const timeOf = (date) => zoned(date).toFormat('h:mm a');
        const outOf = (entry) => {
            if (!entry.clockOut) return 'On the clock';
            const nextDay = !zoned(entry.clockOut).hasSame(zoned(entry.clockIn), 'day');
            return `${timeOf(entry.clockOut)}${nextDay ? ' +1' : ''}`;
        };
        table(
            [{ label: 'Date', width: 104 }, { label: 'Job', width: 170 }, { label: 'In', width: 64, align: 'right' }, { label: 'Out', width: 78, align: 'right' }, { label: 'Break', width: 48, align: 'right' }, { label: 'Hours', width: 52, align: 'right' }],
            statement.entries.map((entry) => ({
                cells: [zoned(entry.clockIn).toFormat('ccc, LLL d'), entry.jobName, timeOf(entry.clockIn), outOf(entry), entry.breakMinutes ? `${entry.breakMinutes} min` : '—', entry.paidMinutes == null ? '—' : formatHours(entry.paidMinutes)],
            })),
            y + 22,
            { zebra: true },
        );

        // On every page: what this is (and isn't), and the page number
        const { start, count } = doc.bufferedPageRange();
        for (let index = start; index < start + count; index++) {
            doc.switchToPage(index);
            const footerY = PAGE.height - PAGE.margin - 22;
            doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
            rule(footerY - 8);
            doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.muted).text(
                'An estimate from the hours recorded in ShiftBuddy — not an official pay stub. Your employer’s stub may also show stat holiday pay, vacation pay, CPP, EI and income tax.',
                left,
                footerY,
                { width: WIDTH - 90, lineGap: 2 },
            );
            text(`Page ${index - start + 1} of ${count}`, left + WIDTH - 80, footerY, { size: 7.5, color: COLOR.muted, width: 80, align: 'right' });
        }
        doc.end();
    });

module.exports = { renderStatementPdf };
