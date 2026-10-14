# ShiftBuddy Backend — Learning Notes
### A chapter-by-chapter guide to what we've built and why

---

## How to use this document

Each chapter covers one part of the system. For every piece of code you'll find:
- **What it does** — plain English
- **Why it exists** — the reasoning, not just the syntax
- **Key things to remember** — the "if you forget everything else, remember this"

This is meant to be read alongside your actual code, not instead of it. When something clicks, you'll understand it enough to write it yourself next time without needing to copy-paste.

---

# Chapter 1: Project Foundation

## 1.1 Why this folder structure?

```
shiftbuddy-backend/
├── src/
│   ├── config/         → app-wide setup (database connection, env validation)
│   ├── controllers/     → thin functions that connect routes to services
│   ├── middleware/       → functions that run BEFORE your route logic
│   ├── routes/            → URL → function mapping
│   ├── services/          → the actual business logic
│   ├── utils/              → small reusable helper functions
│   └── validation/         → rules for what "valid input" looks like
├── prisma/
│   └── schema.prisma      → your database structure, defined in code
└── .env                    → secrets (never committed to Git)
```

**Why separate folders instead of one big file?**

Imagine your whole app in one 2000-line file. You want to change how passwords are hashed — you'd have to scroll through routes, validation, and error handling to find the one line that matters. Separation means: *if you're debugging login, you know exactly which 2-3 files to look at.*

**The golden rule we're following:**
> A route file should never talk to the database directly. A controller should never contain business logic. A service should never know what an HTTP request looks like.

Each layer has ONE job. This is called **separation of concerns**, and it's the #1 thing that separates "code that works" from "code a team can actually maintain."

## 1.2 Packages installed — what each one does

| Package | Job | Why we need it |
|---|---|---|
| `express` | Web server framework | Handles incoming HTTP requests/responses |
| `cors` | Cross-Origin Resource Sharing | Lets your mobile app (different origin) talk to this API |
| `dotenv` | Loads `.env` file | Keeps secrets out of your code |
| `@prisma/client` | Database query tool | Lets you write `prisma.user.create()` instead of raw SQL |
| `bcryptjs` | Password hashing | Turns "Passw0rd123" into unreadable gibberish before storing |
| `jsonwebtoken` | Creates/verifies login tokens | Proves "this request really is from a logged-in user" |
| `google-auth-library` | Verifies Google Sign-In tokens | Confirms a Google login is genuine |
| `zod` | Input validation | Rejects bad data before it touches your database |
| `helmet` | Security headers | Adds HTTP headers that block common attacks |
| `morgan` | Request logging | Prints every incoming request to your terminal (dev only) |
| `express-rate-limit` | Attack prevention | Blocks someone from trying 1000 passwords per second |

**Key thing to remember:** every one of these solves a *specific, real* problem. If you ever wonder "why is this package here," come back to this table.

## 1.3 Prisma — what it actually is

Prisma is an **ORM** (Object-Relational Mapper). In plain English: instead of writing raw SQL like

```sql
SELECT * FROM users WHERE email = 'test@example.com';
```

you write:

```javascript
prisma.user.findUnique({ where: { email: 'test@example.com' } });
```

**Why this matters:** Prisma reads your `schema.prisma` file and auto-generates JavaScript functions that match your exact database structure. If you typo a field name, you get an error *immediately in your code editor* — not a mysterious SQL failure at 2am in production.

**Key things to remember:**
- `prisma/schema.prisma` = the single source of truth for your database structure
- Every time you change this file, you must run `npx prisma migrate dev --name <what_changed>` to apply it to the real database
- We're on **Prisma v6** (not v7) because v7 moved the database URL to a separate `prisma.config.ts` file, which added complexity we don't need yet

---

# Chapter 2: Database Layer

## 2.1 The User model

```prisma
model User {
  id              String   @id @default(uuid())
  email           String   @unique
  name            String

  password        String?
  googleId        String?  @unique

  avatarUrl       String?
  isEmailVerified Boolean  @default(false)
  refreshToken    String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("users")
}
```

**Field-by-field reasoning:**

| Field | Why it's designed this way |
|---|---|
| `id String @id @default(uuid())` | UUID instead of a simple counting number (1, 2, 3...) — harder to guess, safer if ever exposed in a URL |
| `email String @unique` | The database itself refuses two users with the same email — this is a safety net *even if* your code forgets to check |
| `password String?` | The `?` means **nullable**. A user who signs up via Google never sets a password, so this field must be allowed to be empty |
| `googleId String? @unique` | Same nullable logic — only set for Google users, and unique so no two accounts link to the same Google account |
| `refreshToken String?` | Starts empty, gets filled the moment a user logs in |
| `createdAt` / `updatedAt` | Prisma manages these automatically — you never set them yourself |
| `@@map("users")` | The actual table name in Postgres is lowercase `users`, even though the Prisma model is `User` — this is just a naming convention |

**Key thing to remember:** every time you see a `?` after a type in Prisma, it means "this can be empty" — always ask yourself *why* it's allowed to be empty. If you can't answer, it probably shouldn't be nullable.

---

# Chapter 3: Authentication System

This is the big chapter. Auth is broken into layers — read them in order, because each one builds on the last.

## 3.1 Core utilities (the toolkit every other file uses)

### `src/utils/ApiError.js`

```javascript
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.success = false;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
```

**What it does:** a custom error type. Instead of `throw new Error("bad")`, we throw `throw new ApiError(409, "Email already exists")` — carrying an HTTP status code with it.

**Why it exists:** JavaScript's built-in `Error` has no concept of "this should be a 404" vs "this should be a 500." Our `ApiError` lets any part of the app say *exactly* what HTTP response this error deserves, and our error handler (below) knows how to read that.

### `src/utils/ApiResponse.js`

```javascript
class ApiResponse {
  constructor(statusCode, data, message = 'Success') {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }
}

module.exports = ApiResponse;
```

**What it does:** wraps every successful response in the same shape: `{ statusCode, data, message, success }`.

**Why it exists:** consistency. When the mobile app receives a response, it always knows where to look for the actual data (`response.data`) and whether it succeeded (`response.success`) — regardless of which endpoint it called.

### `src/utils/asyncHandler.js`

```javascript
const asyncHandler = (requestHandler) => (req, res, next) => {
  Promise.resolve(requestHandler(req, res, next)).catch(next);
};

module.exports = asyncHandler;
```

**What it does:** wraps an async function so that if it throws an error, Express's error-handling system catches it automatically.

**Why it exists — this is the trickiest one to understand:** normally in Express, if an `async` function throws an error, Express does NOT catch it automatically (this is an old, well-known gotcha). Without `asyncHandler`, every single controller would need:

```javascript
const register = async (req, res) => {
  try {
    // logic
  } catch (err) {
    // manually forward the error
  }
};
```

Repeated in every function = messy. `asyncHandler` does this once, wraps around any function, and you never write `try/catch` in a controller again.

### `src/middleware/errorHandler.js`

```javascript
const ApiError = require('../utils/ApiError');

const errorHandler = (err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: `A record with this ${err.meta?.target?.join(', ') || 'value'} already exists`,
    });
  }

  console.error('Unhandled error:', err);

  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
};

module.exports = errorHandler;
```

**What it does:** the single place in the entire app where errors turn into HTTP responses.

**Why it exists:** without this, an unhandled error would crash your server or send an ugly HTML error page. This function is the safety net — no matter what breaks, anywhere in the app, this function catches it and sends back clean JSON.

**Why `err.code === 'P2002'` specifically:** this is a Prisma-specific error code that means "unique constraint violated" — e.g., trying to register with an email that already exists. We translate Prisma's cryptic code into a human-readable message.

**Key thing to remember:** this middleware MUST be registered **last** in `app.js` — after every route. Express runs middleware top to bottom, and error handlers only work if they're at the very end.

---

## 3.2 JWT tokens — the heart of "staying logged in"

### `src/utils/token.js`

```javascript
const jwt = require('jsonwebtoken');

const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '30d' }
  );
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
```

**What a JWT actually is:** a signed string with three parts (header.payload.signature). The "payload" contains data (like `userId`), and the "signature" proves the token wasn't tampered with — because it's signed with a secret only your server knows.

**Why TWO tokens (access + refresh) instead of one?**

Think of it like a hotel:
- **Access token** = your room key card. Works for a short time (15 min), you use it constantly (every request), and if you lose it, the damage is limited because it expires soon.
- **Refresh token** = the master key you keep in a safe. You rarely use it — only to get a *new* room key card when the old one expires. It lasts much longer (30 days).

If your access token leaks (e.g., in a log file), an attacker only has 15 minutes of access. If it were valid for 30 days, that's a much bigger problem.

**Key things to remember:**
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be different, long, random strings — stored in `.env`, never in code
- `jwt.verify()` throws an error if the token is invalid OR expired — that's why we wrap it in `try/catch` wherever we verify a token
- Anyone can technically *read* what's inside a JWT (it's not encrypted, just signed) — never put a password or sensitive data inside the payload

---

## 3.3 Input validation — rejecting bad data early

### `src/validation/auth.validation.js`

```javascript
const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

module.exports = {
  registerSchema,
  loginSchema,
};
```

**What Zod does:** describes "what valid data looks like" as code, then checks incoming data against that description.

**Why validate here, and not just rely on the database?** By the time bad data reaches your database, it's already too late — you might get a cryptic database error, or worse, save garbage data. Validating at the very entrance (before any logic runs) means:
1. The error message is clear and specific ("Password must contain a number" vs. a database crash)
2. Bad data never reaches your business logic or database at all

**Why `.trim()` and `.toLowerCase()` on email?** Real users make typos — extra spaces, inconsistent capitalization ("Test@Example.com" vs "test@example.com"). Without normalizing, your database could end up with two "different" accounts that are actually the same email. This is called **sanitization** — cleaning data as part of validating it.

### `src/middleware/validate.middleware.js`

```javascript
const ApiError = require('../utils/ApiError');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return next(new ApiError(400, 'Validation failed', fieldErrors));
  }

  req.body = result.data;
  next();
};

module.exports = validate;
```

**What it does:** a *generic* middleware — it doesn't know or care what schema it's checking. You hand it any Zod schema, and it validates `req.body` against it.

**Why this pattern (a function that returns a function) instead of writing separate validation code for each route?** This is called a **higher-order function**. Instead of:

```javascript
router.post('/register', validateRegisterInput, ...)
router.post('/login', validateLoginInput, ...)
```

(two nearly-identical validation functions), we write ONE reusable `validate()` and just tell it *which* schema to use per route:

```javascript
router.post('/register', validate(registerSchema), ...)
router.post('/login', validate(loginSchema), ...)
```

This is a pattern you'll see constantly in real production code — write the reusable machinery once, configure it differently per use case.

---

## 3.4 Register — creating a new account

### `src/services/auth.service.js` (register part)

```javascript
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');

const SALT_ROUNDS = 10;

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl,
  isEmailVerified: user.isEmailVerified,
});

const issueTokensAndPersist = async (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  const hashedRefreshToken = await bcrypt.hash(refreshToken, SALT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashedRefreshToken },
  });

  return { accessToken, refreshToken };
};

const registerUser = async ({ name, email, password }) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
  });

  const tokens = await issueTokensAndPersist(user);

  return { user: toPublicUser(user), ...tokens };
};
```

**Step-by-step reasoning:**

1. **Check for existing email first.** Why not just try to create and catch the duplicate error? You *could* — but checking first gives a clearer, faster-to-understand code path. (Note: we *also* catch this at the database level via the `P2002` error in `errorHandler.js` — that's a backup safety net, not the primary check.)

2. **`bcrypt.hash(password, SALT_ROUNDS)`.** This is the single most important security line in the whole file. `SALT_ROUNDS = 10` means the hashing algorithm runs 10 rounds of complexity — high enough to be very slow to crack, low enough to not noticeably slow down your app. **Never lower this number**, and never store `password` directly.

3. **`toPublicUser()`.** Notice this function exists specifically to define what's *safe* to send back to the client. `password` and `refreshToken` are deliberately left out — this is called the principle of **least exposure**: only return what's needed, nothing more.

4. **Why register a user AND log them in immediately (`issueTokensAndPersist`)?** This is a UX decision — most modern apps skip the "register, then separately log in" friction and just log the user in right after signup. That's why `registerUser` returns tokens, just like `loginUser` does.

**Why hash the refresh token before storing it (`bcrypt.hash(refreshToken, ...)`)?** Same logic as passwords: if your database ever leaked, an attacker with raw refresh tokens could impersonate every user forever (30-day validity!). By storing only the *hash*, a database leak alone isn't enough to steal sessions.

---

## 3.5 Login — verifying an existing account

```javascript
const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.password) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const tokens = await issueTokensAndPersist(user);

  return { user: toPublicUser(user), ...tokens };
};
```

**Why `!user || !user.password` together, in one check?**

Two different situations produce the same error message on purpose:
- The email doesn't exist at all (`!user`)
- The email exists, but belongs to a Google-only account with no password (`!user.password`)

**Why hide which situation it is?** This is a deliberate security choice called avoiding **account enumeration**. If we said "no account with this email" vs "wrong password" as *different* messages, an attacker could figure out which emails are registered on your app just by trying many emails and watching which error comes back. One generic message closes that loophole.

**`bcrypt.compare(password, user.password)`** — this is the counterpart to `bcrypt.hash()`. You can never "un-hash" a password to check it directly; instead, `bcrypt.compare` re-hashes the input and checks if the result matches the stored hash. This returns `true`/`false`.

**Why call `issueTokensAndPersist` again here (same as register)?** Because logging in should have the exact same *outcome* as registering — a valid session with fresh tokens. This is why we extracted that logic into its own reusable function instead of duplicating it in both `registerUser` and `loginUser`. **This is the DRY principle** (Don't Repeat Yourself) in action.

---

## 3.6 Wiring it together

### `src/controllers/auth.controller.js`

```javascript
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/auth.service');

const register = asyncHandler(async (req, res) => {
  const result = await authService.registerUser(req.body);
  res.status(201).json(new ApiResponse(201, result, 'Account created successfully'));
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.loginUser(req.body);
  res.status(200).json(new ApiResponse(200, result, 'Logged in successfully'));
});

module.exports = {
  register,
  login,
};
```

**Why is this file so short and "boring"?** That's by design. A controller's ONLY job is:
1. Call the service function with the request data
2. Send back a response

If you find yourself writing `if` statements, database calls, or password logic inside a controller, that logic belongs in the **service** instead. Keeping controllers this thin is what makes the codebase easy to navigate — you always know exactly where to look for "the actual logic."

### `src/routes/auth.routes.js`

```javascript
const express = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const { registerSchema, loginSchema } = require('../validation/auth.validation');

const router = express.Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);

module.exports = router;
```

**Read this line left to right — this is the entire request lifecycle in one line:**

```
POST /register  →  validate(registerSchema)  →  authController.register
     (URL)              (middleware runs first)         (then this runs)
```

Express runs each argument **in order**. If `validate()` throws an error (bad input), `authController.register` never even runs. This is called a **middleware chain**.

### `src/app.js`

```javascript
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');

require('dotenv').config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'ShiftBuddy API is running' });
});

app.use('/api/auth', authRoutes);

app.use(errorHandler);

module.exports = app;
```

**Why `app.use('/api/auth', authRoutes)` and not just `/register` directly?** This is called **route prefixing**. Every route defined inside `auth.routes.js` (`/register`, `/login`) automatically gets `/api/auth` stuck in front of it. So `/register` becomes `/api/auth/register`. This keeps route files organized by feature — later we'll have `/api/shifts`, `/api/jobs`, etc., each with their own routes file.

**Why does `errorHandler` come dead last?** Express processes middleware top-to-bottom. If `errorHandler` were placed before the routes, it would never catch anything, because errors haven't happened yet at that point in the chain.

---

# What We Tested (and what the errors taught us)

| What happened | What it taught us |
|---|---|
| PowerShell's `curl` isn't real curl | Windows has its own aliases — `curl.exe` forces the real one |
| Prisma v7 broke `datasource url` in schema.prisma | Major version upgrades can introduce breaking changes — always check release notes, or pin to a known-stable major version (we chose v6) |
| `secretOrPrivateKey must have a value` | Empty `.env` values fail silently until the exact line that uses them runs — always double check `.env` is fully filled in after copying it |
| `Can't reach database server` (once, transiently) | Managed databases (Render, Neon, etc.) can have brief connection hiccups — always worth a retry before assuming your code is broken |

**The single biggest lesson from this chapter:** almost every bug we hit was a **configuration** issue (missing env var, wrong Prisma version, terminal quirk) — not a logic bug. Reading error messages carefully and matching them to "is this MY code or my SETUP" is 80% of backend debugging.

---

# What's Next

- **3.7 — `requireAuth` middleware + `/me` route:** how the server recognizes "this request belongs to a logged-in user" using the access token
- **3.8 — Google Sign-In:** verifying a Google-issued token instead of a password
- **3.9 — Refresh token flow:** exchanging an expired access token for a new one, without forcing the user to log in again
- **3.10 — Logout:** invalidating a session server-side

Each of these will get the same treatment: concept first, then code, then test, then this document gets updated.
