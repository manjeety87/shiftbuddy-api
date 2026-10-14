const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const jobService = require('../services/job.service');

const createJob = asyncHandler(async (req, res) => {
    const job = await jobService.createJob(req.user.id, req.body);
    res.status(201).json(new ApiResponse(201, job, 'Job created successfully'));
});

const getMyJobs = asyncHandler(async (req, res) => {
    const jobs = await jobService.getMyJobs(req.user.id);
    res.status(200).json(new ApiResponse(200, jobs, 'Jobs fetched successfully'));
});

const getJobById = asyncHandler(async (req, res) => {
    const job = await jobService.getJobById(req.user.id, req.params.jobId);
    res.status(200).json(new ApiResponse(200, job, 'Job fetched successfully'));
});

const updateJob = asyncHandler(async (req, res) => {
    const job = await jobService.updateJob(req.user.id, req.params.jobId, req.body);
    res.status(200).json(new ApiResponse(200, job, 'Job updated successfully'));
});

const deleteJob = asyncHandler(async (req, res) => {
    await jobService.deleteJob(req.user.id, req.params.jobId);
    res.status(200).json(new ApiResponse(200, null, 'Job deleted successfully'));
});

module.exports = {
    createJob,
    getMyJobs,
    getJobById,
    updateJob,
    deleteJob,
};