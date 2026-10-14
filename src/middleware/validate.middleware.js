const ApiError = require('../utils/ApiError');

const SOURCES = ['params', 'query', 'body'];

/**
 * Checks a request against zod schemas before the controller runs.
 *
 *   validate(createShiftSchema)                          // body only
 *   validate({ params: idParams('shiftId'), query: q })  // any mix of params / query / body
 *
 * The cleaned values (trimmed, coerced, defaults applied) replace `req.body`
 * and land on `req.validated.params` / `req.validated.query` — Express 5 makes
 * `req.query` read-only, so it can't be replaced in place.
 *
 * On failure: 400 whose `message` is the first problem (safe to show as-is)
 * and whose `details` lists every field.
 */
const validate = (schemas) => {
    const bySource = typeof schemas.safeParse === 'function' ? { body: schemas } : schemas;

    return (req, res, next) => {
        const validated = {};
        const fieldErrors = [];

        for (const source of SOURCES) {
            const schema = bySource[source];
            if (!schema) continue;

            const result = schema.safeParse(req[source] ?? {});
            if (result.success) {
                validated[source] = result.data;
            } else {
                fieldErrors.push(...result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
            }
        }

        if (fieldErrors.length > 0) {
            return next(new ApiError(400, fieldErrors[0].message, fieldErrors));
        }

        if (validated.body !== undefined) req.body = validated.body;
        req.validated = validated;
        next();
    };
};

module.exports = validate;
