/**
 * Extension point for Pro/Non-Pro limits (V2).
 *
 * V1 me ye function HAMESHA allow karta hai — koi limit nahi hai abhi.
 * Jab V2 me actual limits lagane hon:
 *   - FREE: max 2 images/week
 *   - PRO: unlimited, multiple images ek saath
 *   - TESTER: hamesha unlimited (QA/testing account ke liye, real users ko show nahi hoga)
 * Sirf ISI function ke andar logic likhna hoga — baaki poora OCR flow
 * (route/controller/service) bilkul waise hi rahega.
 */
const canUserUploadImage = async (userId) => {
    // TODO (V2): user.plan fetch karo. Agar TESTER/PRO hai, hamesha allow.
    // Agar FREE hai, is week ke uploads count karo (naya "usage tracking"
    // model banake), max 2/week enforce karo.
    return { allowed: true, reason: null };
};

module.exports = { canUserUploadImage };