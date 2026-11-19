const express = require('express');
const { isConnected } = require('../config/database');

const router = express.Router();

// GET /health/live — always 200
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /health/ready — check DB connection
router.get('/ready', (req, res) => {
  if (!isConnected()) {
    return res.status(503).json({
      status: 'not_ready',
      db: 'disconnected',
    });
  }

  res.status(200).json({
    status: 'ok',
    db: 'sqlite',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

module.exports = router;
