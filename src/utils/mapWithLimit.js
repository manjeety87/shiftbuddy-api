/**
 * Like `Promise.all(items.map(work))`, but with at most `limit` running at a
 * time. Results keep the order of `items`. Used where each item means a call to
 * someone else's server, so one request of ours can't become dozens of theirs.
 */
const mapWithLimit = async (items, limit, work) => {
    const results = new Array(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await work(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

module.exports = { mapWithLimit };
