'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { maxFileSize } = require('../config/environment');
const videos = require('../repositories/videoRepository');
const storage = require('../services/storageService');
const transcoding = require('../services/transcodingService');
const { validateUpload } = require('../utils/mediaValidator');
const { validateVideoFile } = require('../utils/ffprobeHelper');
const cache = require('../services/cacheService');
const { isValidCsrf } = require('../middleware/security');
const { isConnected, dataDir } = require('../config/database');
const ffprobeStatic = require('ffprobe-static');
const ffmpegStatic = require('ffmpeg-static');

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, storage.roots.temp),
    filename: (_req, file, callback) => callback(null, storage.createKey(path.extname(file.originalname))),
  }),
  limits: { fileSize: maxFileSize, files: 1 },
});

const formatDuration = (seconds) => {
  if (!seconds) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

router.post('/upload', requireAuth, requireAdmin, (req, res) => {
  upload.single('video')(req, res, async (uploadError) => {
    if (uploadError || !req.file) {
      return res.redirect(`/admin/dashboard?error=${encodeURIComponent(uploadError?.message || 'Choose a video file')}`);
    }
    if (!isValidCsrf(req, req.body?.csrfToken || '')) {
      fs.unlinkSync(req.file.path);
      return res.status(403).send('Invalid CSRF token');
    }
    let storedKey;
    try {
      const { title, description, tags } = req.body;
      if (!String(title || '').trim() || String(title).length > 160) throw new Error('A title of at most 160 characters is required');
      const validation = validateUpload(req.file);
      if (!validation.valid) throw new Error(validation.error);
      await validateVideoFile(req.file.path);
      storedKey = storage.putFile(req.file.path, 'originals');
      const created = videos.create({
        title: String(title).trim(),
        description: String(description || '').slice(0, 5000),
        tags: String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
        originalFilename: path.basename(req.file.originalname).slice(0, 255),
        storageKey: storedKey,
        fileSize: req.file.size,
      });
      cache.invalidateVideo(created.id);
      transcoding.enqueue(created.id);
      return res.redirect('/admin/dashboard?success=Upload queued for processing');
    } catch (error) {
      if (storedKey) storage.deleteFile('originals', storedKey);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error(`[upload] ${error.message}`);
      return res.redirect(`/admin/dashboard?error=${encodeURIComponent(error.message || 'Upload failed')}`);
    }
  });
});

router.get('/dashboard', requireAuth, requireAdmin, (req, res) => {
  const allVideos = videos.listAll();
  const stats = {
    totalVideos: allVideos.length,
    totalViews: allVideos.reduce((sum, video) => sum + video.views, 0),
    totalSize: Math.round(allVideos.reduce((sum, video) => sum + video.fileSize, 0) / (1024 * 1024)),
  };
  res.render('admin/dashboard', { videos: allVideos, user: req.session.user, stats, formatDuration });
});

router.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
  const video = videos.findById(req.params.id);
  if (!video) return res.redirect('/admin/dashboard?error=Video not found');
  try {
    for (const variant of videos.variants(video.id)) storage.deleteFile('transcoded', variant.storage_key);
    if (video.thumbnail_key) storage.deleteFile('thumbnails', video.thumbnail_key);
    storage.deleteFile('originals', video.storage_key);
    videos.deleteById(video.id);
    cache.invalidateVideo(video.id);
    return res.redirect('/admin/dashboard?success=Video deleted');
  } catch (error) {
    console.error(`[delete] ${error.message}`);
    return res.redirect('/admin/dashboard?error=Delete failed');
  }
});

function systemStatus() {
  let storageWritable = false;
  try { fs.accessSync(dataDir, fs.constants.W_OK); storageWritable = true; } catch { storageWritable = false; }
  return {
    cache: cache.stats(),
    database: { connected: isConnected(), type: 'sqlite' },
    ffmpeg: { available: Boolean(ffmpegStatic), ffprobe: Boolean(ffprobeStatic) },
    storage: { directory: dataDir, writable: storageWritable },
    processingQueue: { pending: transcoding.getQueueLength() },
  };
}

router.get('/system', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/system', { user: req.session.user, status: systemStatus() });
});

router.get('/system.json', requireAuth, requireAdmin, (_req, res) => {
  res.json(systemStatus());
});

router.post('/cache/clear', requireAuth, requireAdmin, (_req, res) => {
  cache.clear();
  res.redirect('/admin/system');
});

module.exports = router;