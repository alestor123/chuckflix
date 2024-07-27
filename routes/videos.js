const express = require('express');
const router = express.Router();
const Video = require('../models/Video');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 500 // 500MB limit
    }
});

// Get all videos
router.get('/', async (req, res) => {
    try {
        const videos = await Video.find().populate('uploadedBy', 'username');
        res.json(videos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Upload video
router.post('/', auth.ensureAuthenticated, auth.ensureAdmin, upload.single('video'), async (req, res) => {
    try {
        // Get video metadata using ffmpeg
        const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(req.file.path, (err, metadata) => {
                if (err) reject(err);
                resolve(metadata.format.duration);
            });
        });

        // Generate thumbnail
        const thumbnailPath = `uploads/thumbnails/${req.file.filename}.jpg`;
        await new Promise((resolve, reject) => {
            ffmpeg(req.file.path)
                .screenshots({
                    count: 1,
                    filename: path.basename(thumbnailPath),
                    folder: path.dirname(thumbnailPath),
                    size: '320x240'
                })
                .on('end', resolve)
                .on('error', reject);
        });

        const video = new Video({
            title: req.body.title,
            description: req.body.description,
            filePath: req.file.path,
            thumbnailPath: thumbnailPath,
            duration: metadata,
            tags: req.body.tags ? req.body.tags.split(',') : [],
            uploadedBy: req.user.id
        });

        await video.save();
        res.json(video);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Update video progress
router.put('/:id/progress', auth.ensureAuthenticated, async (req, res) => {
    try {
        const video = await Video.findById(req.params.id);
        if (!video) {
            return res.status(404).json({ message: 'Video not found' });
        }
        video.lastPlayedTime = req.body.currentTime;
        await video.save();
        res.json(video);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
