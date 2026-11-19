'use strict';

/**
 * middleware/security.js
 * - helmet (with relaxed CSP for EJS / inline scripts)
 * - cors
 * - request-body size limits
 * - auth rate-limiter
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const config = require('../config/environment');

// ─── Helmet ───────────────────────────────────────────────────────────────────
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // EJS inline scripts — tighten later
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // relaxed for video streaming
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsMiddleware = cors({
  origin: config.corsOrigin || false, // disabled by default; set CORS_ORIGIN to enable
  credentials: true,
});

// ─── Auth rate-limiter ────────────────────────────────────────────────────────
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skipSuccessfulRequests: false,
});

function isValidCsrf(req, supplied = req.get('x-csrf-token') || req.body?.csrfToken || '') {
  const expected = req.session.csrfToken;
  return typeof supplied === 'string' && supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.is('multipart/form-data')) return next();
    if (!isValidCsrf(req)) return res.status(403).send('Invalid CSRF token');
  }
  next();
}

// ─── Bundled security middleware array ───────────────────────────────────────
// Apply with: app.use(securityMiddleware);
const securityMiddleware = [
  helmetMiddleware,
  corsMiddleware,
];

module.exports = { securityMiddleware, authRateLimiter, csrfProtection, isValidCsrf };
