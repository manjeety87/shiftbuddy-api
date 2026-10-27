const { GoogleGenAI } = require('@google/genai');
const ApiError = require('./ApiError');
const env = require('../config/env');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Free-tier Gemini models get "high demand" 503s that come and go per model, so
// instead of waiting on one busy model we fall through to the next. Override
// the order with GEMINI_MODELS (comma-separated); GEMINI_MODEL still works for one.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
const configuredModels = env.GEMINI_MODELS.length > 0 ? env.GEMINI_MODELS : [env.GEMINI_MODEL].filter(Boolean);
const GEMINI_MODELS = configuredModels.length > 0 ? configuredModels : DEFAULT_MODELS;
const BUSY_STATUS = new Set([429, 500, 503, 504]);
const GONE_STATUS = new Set([404]); // model retired for this key — just skip it
const SECOND_PASS_DELAY_MS = 3000;
const SECOND_PASS_MODELS = 2; // after a short pause, retry the best two once more

// A model that hangs (seen: 24 s, then 504) is as good as busy — and so is our own timeout
const isBusy = (err) => BUSY_STATUS.has(err.status) || /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|high demand|overloaded|aborted|timed? ?out/i.test(err.message || '');

/**
 * One Gemini call, trying each model in order: a busy or retired model moves on to
 * the next one instead of waiting. `label` names the caller in the logs; the two
 * messages are what the user sees when every model is busy, or one fails outright.
 * `secondPass: false` skips the pause-and-retry and `timeoutMs` gives up on a slow
 * model early (a voice reply can't wait that long).
 */
const generateWithFallback = async (request, { label, busyMessage, failMessage, secondPass = true, timeoutMs }) => {
    const passes = secondPass ? [GEMINI_MODELS, GEMINI_MODELS.slice(0, SECOND_PASS_MODELS)] : [GEMINI_MODELS];
    let sawBusy = false;

    for (let pass = 0; pass < passes.length; pass++) {
        if (pass > 0) {
            if (!sawBusy) break; // nothing was merely busy — another pass won't help
            await new Promise((resolve) => setTimeout(resolve, SECOND_PASS_DELAY_MS));
        }
        for (const model of passes[pass]) {
            try {
                // Our own signal, not httpOptions.timeout: Gemini refuses a deadline under 10 s
                const config = timeoutMs ? { ...request.config, abortSignal: AbortSignal.timeout(timeoutMs) } : request.config;
                const response = await ai.models.generateContent({ ...request, config, model });
                if (model !== GEMINI_MODELS[0] || pass > 0) console.info(`${label} served by ${model}`);
                return response;
            } catch (err) {
                if (isBusy(err)) {
                    sawBusy = true;
                    console.warn(`${label} model ${model} busy (${err.status ?? 'n/a'}), trying the next one`);
                    continue;
                }
                if (GONE_STATUS.has(err.status)) {
                    console.warn(`${label} model ${model} not available for this key, skipping`);
                    continue;
                }
                console.error(`${label} model ${model} failed:`, err.message);
                throw new ApiError(502, failMessage);
            }
        }
    }
    throw new ApiError(503, busyMessage);
};

module.exports = { generateWithFallback };
