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

// The mobile app sends the token here; a browser sends it as an httpOnly cookie
// instead (see utils/refreshCookie.js), so the body may be empty.
const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1).optional(),
});

const googleAuthSchema = z.object({
    idToken: z.string().min(1, 'Google idToken is required'),
});

const forgotPasswordSchema = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

const resetPasswordSchema = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    code: z.string().length(6, 'Code must be 6 digits'),
    newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});

const appleAuthSchema = z.object({
    identityToken: z.string().min(1, 'Apple identityToken is required'),
    // Apple sirf PEHLI baar naam deta hai — isliye ye optional hai,
    // client hi humein forward karega jab pehli baar available ho
    fullName: z.string().trim().optional(),
});

module.exports = {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    googleAuthSchema,
    forgotPasswordSchema,
    changePasswordSchema,
    resetPasswordSchema,
    appleAuthSchema,
};