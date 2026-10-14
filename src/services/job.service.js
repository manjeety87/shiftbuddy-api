const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');

const createJob = (userId, data) => prisma.job.create({ data: { ...data, userId } });

/** The jobs the user has now — deleted ones stay in the database for their past shifts but aren't listed. */
const getMyJobs = (userId) =>
    prisma.job.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
    });

const getJobById = async (userId, jobId) => {
    const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
    // Not found and not yours look the same (404), so ids can't be probed
    if (!job) throw new ApiError(404, 'Job not found');
    return job;
};

const updateJob = async (userId, jobId, data) => {
    await getJobById(userId, jobId);
    return prisma.job.update({ where: { id: jobId, userId }, data });
};

const deleteJob = async (userId, jobId) => {
    await getJobById(userId, jobId);

    // The job itself is only hidden (soft delete), so shifts already worked keep
    // their workplace and pay in the history. Shifts that haven't started yet go
    // with it — otherwise they'd keep showing up, clashing and firing reminders
    // for a job the user no longer has.
    const [, removedShifts] = await prisma.$transaction([
        prisma.job.update({ where: { id: jobId, userId }, data: { isActive: false } }),
        prisma.shift.deleteMany({ where: { jobId, userId, startTime: { gt: new Date() } } }),
    ]);

    return { removedShifts: removedShifts.count };
};

module.exports = {
    createJob,
    getMyJobs,
    getJobById,
    updateJob,
    deleteJob,
};
