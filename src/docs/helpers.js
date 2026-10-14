const { z } = require('zod');

// Small builders so every route's doc reads the same way, and request bodies /
// query params come straight from the zod schemas that validate them — change the
// validation and the docs change with it.

/** zod schema → OpenAPI schema (what the client sends). Dates become date-time strings. */
const fromZod = (schema) => {
    const json = z.toJSONSchema(schema, {
        io: 'input',
        unrepresentable: 'any',
        override: ({ zodSchema, jsonSchema }) => {
            if (zodSchema._zod.def.type === 'date') Object.assign(jsonSchema, { type: 'string', format: 'date-time' });
            if (jsonSchema.format === 'uuid') delete jsonSchema.pattern; // the 300-char regex adds nothing to the docs
        },
    });
    delete json.$schema;
    return json;
};

/** Query parameters from a zod object schema (each property → one `in: query` parameter). */
const queryFromZod = (schema) => {
    const json = fromZod(schema);
    const required = new Set(json.required ?? []);
    return Object.entries(json.properties ?? {}).map(([name, propSchema]) => ({
        name,
        in: 'query',
        required: required.has(name),
        schema: propSchema,
        ...(propSchema.description && { description: propSchema.description }),
    }));
};

const pathParam = (name, description) => ({ name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } });

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** The `{ statusCode, data, message, success }` envelope every success response uses. */
const envelope = (dataSchema) => ({
    type: 'object',
    properties: {
        statusCode: { type: 'integer', example: 200 },
        data: dataSchema ?? { type: 'null' },
        message: { type: 'string' },
        success: { type: 'boolean', example: true },
    },
});

const ok = (description, dataSchema, status = 200) => ({
    [status]: { description, content: { 'application/json': { schema: envelope(dataSchema) } } },
});

const error = (status, description) => ({
    [status]: { description, content: { 'application/json': { schema: ref('Error') } } },
});

// Shared error responses, so each route only lists what's special about it
const errors = {
    validation: error(400, 'Validation failed — `details` lists each field and why'),
    auth: error(401, 'Missing, invalid or expired access token'),
    notFound: error(404, 'Not found, or not yours (we never reveal which)'),
    rateLimited: error(429, 'Too many requests — slow down and retry shortly'),
    upstream: error(503, 'An outside service (routing, maps, AI) is unavailable — try again shortly'),
};

/**
 * One operation. `summary` = what it does (shown in the list); `description` = why it
 * exists and how it behaves (edge cases, limits, side effects).
 */
const op = ({ tag, summary, description, auth = true, params = [], query, body, multipart, responses }) => ({
    tags: [tag],
    summary,
    description,
    ...(auth ? {} : { security: [] }),
    parameters: [...params, ...(query ? queryFromZod(query) : [])],
    ...(body && { requestBody: { required: true, content: { 'application/json': { schema: fromZod(body) } } } }),
    ...(multipart && { requestBody: { required: true, content: { 'multipart/form-data': { schema: multipart } } } }),
    responses: { ...responses, ...(auth ? errors.auth : {}) },
});

module.exports = { fromZod, queryFromZod, pathParam, ref, envelope, ok, error, errors, op };
