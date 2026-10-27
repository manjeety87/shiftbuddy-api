// Same reason as domain.test.js: run in Toronto time so a hidden dependency on the server's zone shows up.
process.env.TZ = 'America/Toronto';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { quickAnswer, languageOf, quickReplyText, spanOn, describeShift, describeProposal, buildSystemPrompt, assistantTools } = require('../src/domain/assistant');
const { assistantMessageSchema } = require('../src/validation/assistant.validation');

const ZONE = 'America/Toronto';
const at = (iso) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
const boathouse = { id: 'b0a7b0a7-0000-4000-8000-000000000001', title: 'Key Holder', companyName: 'Boathouse', color: '#6b8f71' };

test('quick answer: a plain yes or no in English, Hinglish or Hindi; anything with a detail goes to the model', () => {
    for (const yes of ['yes', 'Yes!', 'yeah that’s right', "that's right", 'haan sahi hai add kardo', 'haa', 'theek hai', 'ok add it', 'go ahead', 'हाँ ठीक है', 'हां कर दो', 'bilkul bhai']) {
        assert.equal(quickAnswer(yes), 'yes', yes);
    }
    for (const no of ['no', 'nope', 'cancel', 'nahi', 'nahi rehne do', 'never mind', 'नहीं']) {
        assert.equal(quickAnswer(no), 'no', no);
    }
    for (const unsure of ['haan but make it 6', 'yes, Friday too', 'no, Thursday', 'add a shift tomorrow', 'haan na', 'what time is it', '', 'ok ok ok ok ok ok ok ok ok']) {
        assert.equal(quickAnswer(unsure), null, unsure);
    }
});

test('language and the quick replies follow how it was said', () => {
    assert.equal(languageOf('yes that is right'), 'english');
    assert.equal(languageOf('haan sahi hai'), 'hinglish');
    assert.equal(languageOf('हाँ ठीक है'), 'hindi');
    assert.equal(quickReplyText('haan kardo', { type: 'addShifts', count: 3 }), 'Ho gaya, 3 shifts add kar di.');
    assert.equal(quickReplyText('yes', { type: 'markMissed', count: 1 }), 'Done, marked as missed.');
    assert.equal(quickReplyText('नहीं', 'cancelled'), 'ठीक है, सेव नहीं किया।');
});

test('span: local wall-clock times in the user’s zone; an end before the start is the next morning', () => {
    const day = spanOn('2026-10-28', '09:00', '17:00', ZONE);
    assert.equal(day.startTime.toISOString(), '2026-10-28T13:00:00.000Z');
    assert.equal(day.endTime.toISOString(), '2026-10-28T21:00:00.000Z');
    const closing = spanOn('2026-10-28', '18:00', '02:00', ZONE);
    assert.equal(closing.endTime.toISOString(), '2026-10-29T06:00:00.000Z');
    // The night clocks go back (Nov 1): 22:00–06:00 is nine real hours
    const fallBack = spanOn('2026-10-31', '22:00', '06:00', ZONE);
    assert.equal((fallBack.endTime - fallBack.startTime) / 3600000, 9);
    assert.equal(spanOn('2026-10-28', '9am', '17:00', ZONE), null);
    assert.equal(spanOn('tomorrow', '09:00', '17:00', ZONE), null);
});

test('prompt: the schedule lines carry ids and status, and the waiting card is described', () => {
    const now = at('2026-10-26T12:00');
    const done = { id: 's1', startTime: at('2026-10-24T09:00'), endTime: at('2026-10-24T17:00'), missedReason: null, job: boathouse, timeEntries: [] };
    const missed = { ...done, id: 's2', missedReason: 'SICK' };
    const next = { ...done, id: 's3', startTime: at('2026-10-28T09:00'), endTime: at('2026-10-28T17:00') };
    assert.equal(describeShift(done, ZONE, now), 's1 | Sat 2026-10-24 | 09:00–17:00 | Boathouse (Key Holder) | finished, no hours added');
    assert.match(describeShift(missed, ZONE, now), /missed \(SICK\)$/);
    assert.match(describeShift(next, ZONE, now), /upcoming$/);

    const pending = { type: 'addShifts', shifts: [{ jobId: boathouse.id, startTime: next.startTime, endTime: next.endTime }] };
    const text = describeProposal(pending, { jobs: [boathouse], shiftsById: new Map() }, ZONE);
    assert.equal(text, 'add a shift: Boathouse Wed 2026-10-28 09:00–17:00');

    const prompt = buildSystemPrompt({ name: 'Sam', now, timeZone: ZONE, page: 'calendar', jobs: [boathouse], shifts: [done, next], pendingText: text, features: { timesheet: false } });
    assert.match(prompt, /Monday, 26 October 2026, 12:00/);
    assert.match(prompt, /on the calendar page/);
    assert.match(prompt, /timesheet is switched off/);
    assert.ok(prompt.includes(`${boathouse.id} | Boathouse (Key Holder)`));
});

test('tools: hours and the timesheet page only while the timesheet is on', () => {
    const names = (features) => assistantTools(features).map((tool) => tool.name);
    assert.ok(!names({ timesheet: false }).includes('propose_log_hours'));
    assert.ok(names({ timesheet: true }).includes('propose_log_hours'));
    const pages = assistantTools({ timesheet: false }).find((tool) => tool.name === 'open_page').parametersJsonSchema.properties.page.enum;
    assert.ok(!pages.includes('timesheet'));
});

test('message: history and the card are checked; a pending card keeps only what gets saved', () => {
    const base = { message: 'haan', timeZone: ZONE };
    assert.equal(assistantMessageSchema.safeParse({ ...base, message: '   ' }).success, false);
    assert.equal(assistantMessageSchema.safeParse({ ...base, timeZone: 'Mars/Base' }).success, false);
    assert.equal(assistantMessageSchema.safeParse({ ...base, history: Array.from({ length: 13 }, () => ({ role: 'user', text: 'hi' })) }).success, false);

    const pending = { type: 'addShifts', shifts: [{ jobId: boathouse.id, startTime: '2026-10-28T13:00:00.000Z', endTime: '2026-10-28T21:00:00.000Z' }], preview: { shifts: [] } };
    const parsed = assistantMessageSchema.parse({ ...base, pending });
    assert.equal(parsed.pending.preview, undefined);
    assert.ok(parsed.pending.shifts[0].startTime instanceof Date);
    assert.equal(parsed.pending.allowOverlap, false);
    assert.equal(assistantMessageSchema.safeParse({ ...base, pending: { type: 'deleteEverything' } }).success, false);
});

test('voice form: history and the card arrive as JSON text and are checked like a typed turn', () => {
    const { assistantVoiceSchema } = require('../src/validation/assistant.validation');
    const pending = { type: 'markMissed', shiftId: boathouse.id, reason: 'SICK' };
    const parsed = assistantVoiceSchema.parse({ timeZone: ZONE, history: JSON.stringify([{ role: 'user', text: 'hi' }]), pending: JSON.stringify(pending) });
    assert.deepEqual(parsed.history, [{ role: 'user', text: 'hi' }]);
    assert.equal(parsed.pending.reason, 'SICK');
    assert.deepEqual(assistantVoiceSchema.parse({ timeZone: ZONE }), { timeZone: ZONE, history: [], pending: null });
    assert.equal(assistantVoiceSchema.safeParse({ timeZone: ZONE, history: '[not json' }).success, false);
    assert.equal(assistantVoiceSchema.safeParse({ timeZone: ZONE, pending: JSON.stringify({ type: 'deleteEverything' }) }).success, false);
});
