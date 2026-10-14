/**
 * A small in-memory cache for answers from outside services: entries expire
 * after `ttlMs`, and the oldest is dropped once there are `maxEntries`.
 *
 * `remember(key, load)` is the whole API most callers need: the cached value if
 * there is one, otherwise `load()` — and when several requests ask for the same
 * key at the same moment they share one `load()` instead of each calling the
 * provider. A failed load isn't cached, so the next request tries again.
 *
 * It lives in this process's memory: fine for one server; behind several, each
 * keeps its own (swap for Redis then).
 */
const createTtlCache = ({ ttlMs, maxEntries }) => {
    const entries = new Map(); // key → { expiresAt, value }
    const loading = new Map(); // key → promise of a load in progress

    const get = (key) => {
        const entry = entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return undefined;
        }
        return entry.value;
    };

    const set = (key, value) => {
        entries.delete(key); // re-inserting moves it to the "newest" end
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    };

    const remember = (key, load) => {
        const cached = get(key);
        if (cached !== undefined) return Promise.resolve(cached);

        const inProgress = loading.get(key);
        if (inProgress) return inProgress;

        const promise = Promise.resolve()
            .then(load)
            .then((value) => {
                // null/undefined mean "couldn't work it out" — worth asking again next time
                if (value != null) set(key, value);
                return value;
            })
            .finally(() => loading.delete(key));
        loading.set(key, promise);
        return promise;
    };

    return { get, set, remember };
};

module.exports = { createTtlCache };
