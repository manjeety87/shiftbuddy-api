// A job is known by where it is, not by the role: someone can be a "Sales Associate"
// at two stores. Mirrors the app's lib/jobLabels.ts.

/** What to call a job: its workplace, or the role when no workplace was entered. */
const jobName = (job) => job.companyName?.trim() || job.title;

module.exports = { jobName };
