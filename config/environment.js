'use strict';

/**
 * config/environment.js
 * Loads and validates environment variables. Must be required first in app.js.
 */

require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production');
}

const config = {
  // Core
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 10000,
  isProduction,
  dataDir: process.env.DATA_DIR || './data',

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 7 * 24 * 60 * 60 * 1000, // 7 days

  transcodingEnabled: process.env.TRANSCODING_ENABLED !== 'false',

  // Admin bootstrap
  adminUsername: process.env.ADMIN_USERNAME || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || null,

  // Upload limits
  maxFileSize: (parseInt(process.env.MAX_UPLOAD_MB, 10) || 100) * 1024 * 1024,
};

module.exports = config;
