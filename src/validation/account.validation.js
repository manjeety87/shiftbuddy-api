const { z } = require('zod');
const { idParams } = require('./common.validation');

// Account deletion and devices. A password account confirms a deletion with its
// password; a Google/Apple account (no password) types DELETE. Which one applies
// is the service's call — it knows the account.
const accountDeletionSchema = z.object({
    password: z.string().min(1, 'Enter your password').max(200).optional(),
    confirm: z.string().trim().max(20).optional(),
});

// The short-lived token a sign-in hands back for an account waiting to be deleted
const restoreAccountSchema = z.object({
    restoreToken: z.string().min(1, 'restoreToken is required'),
});

const sessionParams = idParams('sessionId');

module.exports = { accountDeletionSchema, restoreAccountSchema, sessionParams };
