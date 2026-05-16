const path = require('path');
const fs = require('fs');
require('dotenv').config();
const localEnvPath = path.join(__dirname, '../.env');
if (process.env.NODE_ENV !== 'production' && fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath });
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const connectDB = require('./config/db');
const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');
const { processAutoInvests } = require('./services/vault.service');

const app = express();

// Connect to MongoDB
connectDB();

// Trust proxy (for rate limiter behind reverse proxy)
app.set('trust proxy', 1);

// Security headers — relaxed CSP to allow CDN assets and inline scripts for the SPA pages
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// CORS
const envClientUrls = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const normalizeOrigin = (v) => String(v || '')
  .trim()
  .toLowerCase()
  .replace(/\/$/, '');

const allowedOrigins = [
  ...envClientUrls.map(normalizeOrigin),
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].map(normalizeOrigin);

const corsOptions = {
  origin: (origin, cb) => {
    const o = normalizeOrigin(origin);
    if (!origin || allowedOrigins.includes(o)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Paystack webhook needs the raw body for signature verification
// Mount it BEFORE json body parser
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Sanitise NoSQL injection attempts
app.use(mongoSanitize());

// Prevent HTTP parameter pollution
app.use(hpp());

// HTTP request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
}

// Global rate limiter
app.use('/api/', globalLimiter);

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/user', require('./routes/user.routes'));
app.use('/api/gold', require('./routes/gold.routes'));
app.use('/api/payment', require('./routes/payment.routes'));
app.use('/api/kyc', require('./routes/kyc.routes'));
app.use('/api/support', require('./routes/support.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// ── Serve static frontend ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Named page routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/home/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/dashboard/index.html')));
app.get('/dashboard/:tab', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/dashboard/index.html')));
app.get('/dashboard/*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/dashboard/index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/admin/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/login/index.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/signup/index.html')));

// 404 fallback for unmatched API routes
app.use('/api/*', (req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
app.use(errorHandler);

// ── Auto-invest cron (runs every 60 seconds) ───────────────────────────────
setInterval(() => {
  processAutoInvests().catch((err) => logger.error('Auto-invest cron error:', err));
}, 60 * 1000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Aurum Vault server running on port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
