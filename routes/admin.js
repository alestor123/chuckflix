const express = require('express');
const Video = require('../models/Video');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateThumbnail, getVideoDuration } = require('../utils/thumbnailGenerator');

const router = express.Router();
const fs = require('fs');
const multer = require('multer');

const path = require('path');
// Helper function for duration formatting
const formatDuration = (seconds) => {
  if (!seconds) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: 'public/uploads/videos',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed'));
    }
  }
});
router.post('/upload', requireAuth, requireAdmin, upload.single('video'), async (req, res) => {
  try {
    const { title, description, tags } = req.body;
    const videoPath = req.file.path;
    const thumbnailName = req.file.filename.replace(path.extname(req.file.filename), '.jpg');
    const thumbnailPath = `public/uploads/thumbnails/${thumbnailName}`;
    
    // Generate thumbnail and get duration
    await generateThumbnail(videoPath, thumbnailPath);
    const duration = await getVideoDuration(videoPath);
    
    const video = new Video({
      title,
      description,
      filename: req.file.filename,
      originalName: req.file.originalname,
      thumbnailPath: `uploads/thumbnails/${thumbnailName}`,
      duration,
      fileSize: req.file.size,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });
    
    await video.save();
    res.redirect('/admin/dashboard?success=Video uploaded successfully');
  } catch (error) {
    console.error('Upload error:', error);
    res.redirect('/admin/dashboard?error=Upload failed');
  }
});
// Admin dashboard route
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const videos = await Video.find().sort({ uploadDate: -1 });
    const totalViews = videos.reduce((sum, video) => sum + video.views, 0);
    const totalSize = videos.reduce((sum, video) => sum + (video.fileSize || 0), 0);
    
    res.render('admin/dashboard', { 
      videos, 
      user: req.session.user,
      stats: {
        totalVideos: videos.length,
        totalViews,
        totalSize: Math.round(totalSize / (1024 * 1024))
      },
      formatDuration // Pass the function to the template
    });
  } catch (error) {
    res.redirect('/admin/dashboard?error=Failed to load dashboard');
  }
});
router.post('/delete/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const videoId = req.params.id;
    const video = await Video.findById(videoId);
    
    if (video) {
      // Delete video file
      const videoPath = `public/uploads/videos/${video.filename}`;
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      
      // Delete thumbnail
      if (video.thumbnailPath && fs.existsSync(`public/${video.thumbnailPath}`)) {
        fs.unlinkSync(`public/${video.thumbnailPath}`);
      }
      
      await Video.findByIdAndDelete(videoId);
    }
    
    res.redirect('/admin/dashboard?success=Video deleted successfully');
  } catch (error) {
    console.error('Delete error:', error);
    res.redirect('/admin/dashboard?error=Delete failed');
  }
});
module.exports = router;
