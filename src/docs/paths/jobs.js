const v = require('../../validation/job.validation');
const { op, ok, ref, errors, pathParam } = require('../helpers');

const tag = 'Jobs';
const jobId = pathParam('jobId', 'The job’s id');

module.exports = {
    '/jobs': {
        post: op({
            tag, body: v.createJobSchema,
            summary: 'Add a job (a workplace + your role there)',
            description:
                '`companyName` is the workplace and becomes the job’s name everywhere; `title` is the role. ' +
                'Latitude/longitude enable leave-by times and travel conflicts. `matchKeywords` help match scanned schedules to this job.',
            responses: { ...ok('Created job', ref('Job'), 201), ...errors.validation },
        }),
        get: op({
            tag,
            summary: 'List my jobs',
            description: 'Active jobs only, used by job pickers, the Jobs tab and reminders.',
            responses: { ...ok('Jobs', { type: 'array', items: ref('Job') }) },
        }),
    },
    '/jobs/{jobId}': {
        get: op({ tag, params: [jobId], summary: 'One job', description: 'For the edit screen.', responses: { ...ok('The job', ref('Job')), ...errors.notFound } }),
        patch: op({
            tag, params: [jobId], body: v.updateJobSchema,
            summary: 'Edit a job',
            description: 'Send only what changes. Send `location: null` (with null coordinates) to clear the location.',
            responses: { ...ok('Updated job', ref('Job')), ...errors.validation, ...errors.notFound },
        }),
        delete: op({
            tag, params: [jobId],
            summary: 'Remove a job',
            description: 'Soft delete: the job is marked inactive so past shifts and pay history keep their job. Shifts at this job that haven’t started yet are deleted with it.',
            responses: { ...ok('Job removed'), ...errors.notFound },
        }),
    },
};
