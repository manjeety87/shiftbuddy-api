const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DELETION_GRACE_DAYS, purgeDateFor, purgeCutoff, describeDevice } = require('../src/domain/account');
const { accountDeletionSchema } = require('../src/validation/account.validation');

test('a deleted account is erased 30 days after the request, and the purge cutoff is the same distance back', () => {
    assert.equal(DELETION_GRACE_DAYS, 30);
    const requested = new Date('2026-10-20T15:00:00Z');
    assert.equal(purgeDateFor(requested).toISOString(), '2026-11-19T15:00:00.000Z');
    assert.equal(purgeCutoff(new Date('2026-11-19T15:00:00Z')).toISOString(), requested.toISOString());
});

test('devices are named the way people say them', () => {
    const cases = [
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome on Windows'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge on Windows'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari on Mac'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
        ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
        ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36', 'Samsung Internet on Android'],
        ['okhttp/4.12.0', 'ShiftBuddy app on Android'],
        ['ShiftBuddy/1 CFNetwork/1568.100.1 Darwin/24.0.0', 'ShiftBuddy app on iPhone'],
    ];
    for (const [agent, name] of cases) assert.equal(describeDevice(agent).name, name, agent);
    assert.deepEqual(describeDevice(undefined), { kind: 'unknown', name: 'Unknown device' });
    assert.equal(describeDevice('okhttp/4.12.0').kind, 'app');
});

test('a deletion request carries a password or a typed confirmation, never anything huge', () => {
    assert.ok(accountDeletionSchema.safeParse({ password: 'Secret123' }).success);
    assert.ok(accountDeletionSchema.safeParse({ confirm: ' DELETE ' }).success);
    assert.equal(accountDeletionSchema.parse({ confirm: ' DELETE ' }).confirm, 'DELETE');
    assert.ok(!accountDeletionSchema.safeParse({ password: '' }).success);
    assert.ok(!accountDeletionSchema.safeParse({ confirm: 'x'.repeat(50) }).success);
});
