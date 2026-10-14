const express = require('express');
const jobController = require('../controllers/job.controller');
const requireAuth = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { idParams } = require('../validation/common.validation');
const { createJobSchema, updateJobSchema } = require('../validation/job.validation');

const router = express.Router();
const { createJob, getMyJobs, getJobById, updateJob, deleteJob } = jobController;
const jobId = idParams('jobId');

router.use(requireAuth);

router.post('/', validate(createJobSchema), createJob);
router.get('/', getMyJobs);
router.get('/:jobId', validate({ params: jobId }), getJobById);
router.patch('/:jobId', validate({ params: jobId, body: updateJobSchema }), updateJob);
router.delete('/:jobId', validate({ params: jobId }), deleteJob);

module.exports = router;
