'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const videos = require('../repositories/videoRepository');
const storage = require('../services/storageService');
const { getDatabase } = require('../config/database');
const cache = require('../services/cacheService');
const recommendations = require('../services/recommendationService');

const router = express.Router();
function pipeFile(filePath, options, req, res) {
  const stream = fs.createReadStream(filePath, options);
  req.on('aborted', () => stream.destroy());
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
}

const formatDuration = (seconds) => {
  if (!seconds) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

router.get('/browse', requireAuth, (req, res) => {
  const search = String(req.query.search || '').slice(0, 100);
  const library = cache.get(`browse:${search.toLowerCase()}`, () => videos.list({ search }));
  const recommended = recommendations.recommend(req.session.user.id)
    .map((item) => ({ ...videos.findById(item.videoId), reason: item.reason })).filter((item) => item.id);
  const trending = cache.get('trending', () => videos.trending());
  const continueWatching = cache.get(`continue:${req.session.user.id}`, () => videos.continueWatching(req.session.user.id));
  res.render('viewer/browse', { videos: library, recommended, trending, continueWatching, user: req.session.user, search, formatDuration });
});

router.get('/watch/:id', requireAuth, (req, res) => {
  const video = videos.findById(req.params.id);
  if (!video || video.processing_status !== 'ready') return res.status(video ? 503 : 404).send(video ? 'Video is still processing' : 'Video not found');
  const variants = videos.variants(video.id);
  if (!variants.length) return res.status(404).send('Playable video is unavailable');
  videos.recordViewOnce(req.session.user.id, video.id);
  const history = getDatabase().prepare('SELECT progress_seconds FROM watch_history WHERE user_id = ? AND video_id = ?')
    .get(Number(req.session.user.id), video.id);
  const related = recommendations.recommend(req.session.user.id, video.id, 6)
    .map((item) => ({ ...videos.findById(item.videoId), reason: item.reason })).filter((item) => item.id);
  res.render('viewer/watch', {
    video,
    variants,
    initialVariant: variants.find((variant) => variant.format === 'mp4') || variants[0],
    savedProgress: history?.progress_seconds || 0,
    related,
    user: req.session.user,
    formatDuration,
  });
});

router.get('/thumbnail/:id', requireAuth, (req, res) => {
  const video = videos.findById(req.params.id);
  if (!video || !video.thumbnail_key || !storage.fileExists('thumbnails', video.thumbnail_key)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=3600');
  return res.sendFile(storage.getFilePath('thumbnails', video.thumbnail_key));
});

router.get('/stream/:videoId/:variantId', requireAuth, (req, res) => {
  const video = videos.findById(req.params.videoId);
  const variant = videos.variants(req.params.videoId).find((item) => String(item.id) === String(req.params.variantId));
  if (!video || !variant) return res.sendStatus(404);
  const filePath = storage.getFilePath('transcoded', variant.storage_key);
  let stat;
  try { stat = fs.statSync(filePath); } catch { return res.sendStatus(404); }
  if (!stat.isFile()) return res.sendStatus(404);
  const range = req.headers.range;
  const contentType = variant.format === 'webm' ? 'video/webm' : 'video/mp4';
  res.set({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Type': contentType });
  if (!range) {
    res.set('Content-Length', stat.size);
    return pipeFile(filePath, undefined, req, res);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.set('Content-Range', `bytes */${stat.size}`);
    return res.sendStatus(416);
  }
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      res.set('Content-Range', `bytes */${stat.size}`);
      return res.sendStatus(416);
    }
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : stat.size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
    res.set('Content-Range', `bytes */${stat.size}`);
    return res.sendStatus(416);
  }
  end = Math.min(end, stat.size - 1);
  res.status(206).set({
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': end - start + 1,
  });
  return pipeFile(filePath, { start, end }, req, res);
});

router.post('/progress/:id', requireAuth, (req, res) => {
  const video = videos.findById(req.params.id);
  if (!video) return res.sendStatus(404);
  const progress = Number(req.body.progressSeconds);
  if (!Number.isFinite(progress) || progress < 0 || progress > Math.max(video.duration, 86400)) return res.status(400).json({ error: 'Invalid playback progress' });
  videos.saveProgress(req.session.user.id, video.id, progress, Boolean(req.body.completed));
  cache.invalidateUser(req.session.user.id);
  res.json({ ok: true });
});

router.get('/api/recommendations', requireAuth, (req, res) => {
  res.json({ recommendations: recommendations.recommend(req.session.user.id, req.query.exclude || null) });
});

module.exports = router;