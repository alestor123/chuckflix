const express = require('express');
const Video = require('../models/Video');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
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

// Browse videos
router.get('/browse', requireAuth, async (req, res) => {
  const { search } = req.query;
  let query = {};
  
  if (search) {
    query = {
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    };
  }
  
  const videos = await Video.find(query).sort({ uploadDate: -1 });
  res.render('viewer/browse', { 
    videos, 
    user: req.session.user, 
    search,
    formatDuration // Pass the function to the template
  });
});

// Watch video
router.get('/watch/:id', requireAuth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).send('Video not found');
    
    res.render('viewer/watch', { 
      video, 
      user: req.session.user,
      formatDuration // Pass the function to the template
    });
  } catch (error) {
    res.status(404).send('Video not found');
  }
});
router.get('/stream/:filename', requireAuth, (req, res) => {
  try {
    const filename = req.params.filename;
    const videoPath = path.join(__dirname, '../public/uploads/videos', filename);
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).send('Video not found');
    }
    
    // Get file stats
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      // Handle range requests for video streaming
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // Serve entire file
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).send('Internal server error');
  }
});
module.exports = router;
