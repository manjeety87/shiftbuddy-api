// The only place that reads process.env. Everything else imports `env`, so a
// missing or mistyped setting stops the server at startup with a clear message
// instead of surfacing as a 500 on someone's first login.
require('dotenv').config({ quiet: true });

const { z } = require('zod');

// "a, b ,c" → ['a', 'b', 'c']
const list = z
    .string()
    .default('')
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    // Hops of reverse proxy in front of the server (Render/Fly/Railway = 1). Rate
    // limits and logs need the real client IP; 0 = talk to clients directly.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('30d'),

    // Browser origins allowed to call the API (the web app). Empty or "*" = any
    // origin, which is only acceptable in development. Native apps send no Origin.
    CORS_ORIGIN: list,
    // For the web app's refresh-token cookie. "lax" when the web app and the API
    // share a site (app.example.com + api.example.com); "none" when they don't.
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    GOOGLE_CLIENT_ID: z.string().optional(),
    // The app's bundle ID plus "host.exp.Exponent" so Apple sign-in also works in Expo Go
    APPLE_BUNDLE_ID: list,
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODELS: list,
    GEMINI_MODEL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    API_CONTACT_EMAIL: z.string().default('shiftbuddy-app'),
    API_DOCS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    // Multiplies every rate limit, for the web app's browser tests: all their accounts sign in
    // from one IP and would hit the sign-in limit. Ignored in production.
    RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(100).default(1),
});

// An empty line in .env (`KEY=`) means "not set", not an empty string
const defined = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));

const parsed = schema.safeParse(defined);
if (!parsed.success) {
    // Names and reasons only — never the values
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    console.error(`❌ Invalid environment — fix .env and restart:\n${problems}`);
    process.exit(1);
}

const env = parsed.data;

module.exports = Object.freeze({
    ...env,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    rateLimitScale: env.NODE_ENV === 'production' ? 1 : env.RATE_LIMIT_SCALE,
    corsAllowsAnyOrigin: env.CORS_ORIGIN.length === 0 || env.CORS_ORIGIN.includes('*'),
});
