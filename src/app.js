const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const accountRoutes = require('./routes/account.routes');
const jobRoutes = require('./routes/job.routes');
const shiftRoutes = require('./routes/shift.routes');
const ocrRoutes = require('./routes/ocr.routes');
const geocodeRoutes = require('./routes/geocode.routes');
const transitRoutes = require('./routes/transit.routes');
const shareRoutes = require('./routes/share.routes');
const timesheetRoutes = require('./routes/timesheet.routes');
const assistantRoutes = require('./routes/assistant.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./utils/errorHandler');

const app = express();

// Behind a host's proxy every request arrives from the proxy's address; this
// tells Express how many hops to skip to find the real client IP.
app.set('trust proxy', env.TRUST_PROXY);

app.use(helmet());

// Browsers only: the web app's origin(s) from CORS_ORIGIN. Requests without an
// Origin header (the mobile app, curl) aren't subject to CORS at all.
app.use(
    cors({
        origin: env.corsAllowsAnyOrigin ? true : env.CORS_ORIGIN,
        credentials: true, // the web app keeps its refresh token in an httpOnly cookie
    })
);

// JSON bodies here are a few KB at most (100 shifts in a bulk create); images
// go through multer, which has its own limit.
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

if (env.isDevelopment) {
    app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
    res.status(200).json({ success: true, message: 'ShiftBuddy API is running' });
});

// API reference (Swagger UI) — on outside production, opt-in there with API_DOCS=true
if (!env.isProduction || env.API_DOCS) {
    const swaggerUi = require('swagger-ui-express');
    const openapi = require('./docs/openapi');
    app.get('/api/docs.json', (req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'ShiftBuddy API', swaggerOptions: { persistAuthorization: true } }));
}

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/transit', transitRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/timesheet', timesheetRoutes);
app.use('/api/assistant', assistantRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
