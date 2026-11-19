'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const recommendations = require('../services/recommendationService');

const router = express.Router();
router.get('/recommendations', requireAuth, (req, res) => {
  res.json({ recommendations: recommendations.recommend(req.session.user.id, req.query.exclude || null) });
});

module.exports = router;