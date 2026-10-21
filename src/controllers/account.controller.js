const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const accountService = require('../services/account.service');
const { clearRefreshCookie } = require('../utils/refreshCookie');

const listSessions = asyncHandler(async (req, res) => {
    const sessions = await accountService.listSessions(req.user.id, req.sessionId);
    res.status(200).json(new ApiResponse(200, sessions, 'Signed-in devices fetched'));
});

const endSession = asyncHandler(async (req, res) => {
    await accountService.endSessionOf(req.user.id, req.validated.params.sessionId, req.sessionId);
    res.status(200).json(new ApiResponse(200, null, 'Device signed out'));
});

const endOtherSessions = asyncHandler(async (req, res) => {
    const result = await accountService.endOtherSessions(req.user.id, req.sessionId);
    res.status(200).json(new ApiResponse(200, result, 'Other devices signed out'));
});

const getSummary = asyncHandler(async (req, res) => {
    const summary = await accountService.accountSummary(req.user.id);
    res.status(200).json(new ApiResponse(200, summary, 'Account summary fetched'));
});

const exportAccount = asyncHandler(async (req, res) => {
    const data = await accountService.exportAccount(req.user.id);
    // A copy of someone's whole account: never kept by a browser or proxy cache
    res.set('Cache-Control', 'no-store');
    res.status(200).json(new ApiResponse(200, data, 'Your data'));
});

const requestDeletion = asyncHandler(async (req, res) => {
    const result = await accountService.requestDeletion(req.user.id, req.body);
    clearRefreshCookie(res);
    res.status(200).json(new ApiResponse(200, result, 'Your account will be deleted'));
});

module.exports = { listSessions, endSession, endOtherSessions, getSummary, exportAccount, requestDeletion };
