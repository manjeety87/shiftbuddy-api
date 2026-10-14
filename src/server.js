// env first: it loads .env and stops the process if a required setting is missing
const env = require('./config/env');
const app = require('./app');
const prisma = require('./config/prisma');

// Requests still running when the host asks us to stop get this long to finish
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

const server = app.listen(env.PORT, async () => {
  console.log(`🚀 ShiftBuddy API running on port ${env.PORT}`);

  if (env.isProduction && env.corsAllowsAnyOrigin) {
    console.warn('⚠️  CORS_ORIGIN is open to every website — set it to the web app’s origin.');
  }

  // Fail loudly at startup instead of on the first login attempt.
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connected');
  } catch (err) {
    const cause = err.message.split(/\r?\n/).filter(Boolean).pop();
    console.error('❌ Database connection failed — check DATABASE_URL in .env.', cause);
  }
});

const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // A stuck connection must not keep the old process alive during a deploy
  setTimeout(() => {
    console.error('Shutdown timed out — forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(async () => {
    await prisma.$disconnect();
    console.log('Server closed, DB disconnected.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A promise nobody awaited failed: log it (the request it belonged to has
// already been answered or timed out) rather than crash every other request.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
