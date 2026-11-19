'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { getDatabase } = require('../config/database');
const storage = require('./storageService');
const videos = require('../repositories/videoRepository');
const transcoding = require('./transcodingService');

const samples = [
  { title: 'Color Field: Red', description: 'A generated red field study with original synthetic media.', tags: ['art', 'color', 'design'], color: '0x8e2635', size: '640x360' },
  { title: 'Color Field: Green', description: 'A generated green field study with original synthetic media.', tags: ['nature', 'color', 'science'], color: '0x287a5b', size: '640x360' },
  { title: 'Color Field: Blue', description: 'A generated high-resolution blue field study with original synthetic media.', tags: ['technology', 'science', 'design'], color: '0x27628e', size: '1280x720' },
];

function generateClip(sample, outputPath) {
  const executable = process.env.FFMPEG_PATH || (fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : ffmpegStatic);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-f', 'lavfi', '-i', `color=c=${sample.color}:s=${sample.size}:r=24:d=3`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', '-y', outputPath], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg demo generation exited with ${code}`)));
  });
}

async function seedDemoIfEmpty() {
  const db = getDatabase();
  if (db.prepare('SELECT COUNT(*) AS count FROM videos').get().count > 0) return [];
  const ids = [];
  for (const sample of samples) {
    const tempPath = path.join(storage.roots.temp, `${storage.createKey('.mp4')}`);
    try {
      await generateClip(sample, tempPath);
      const storageKey = storage.putFile(tempPath, 'originals');
      const video = videos.create({
        title: sample.title,
        description: sample.description,
        tags: sample.tags,
        originalFilename: 'synthetic-demo.mp4',
        storageKey,
        fileSize: fs.statSync(storage.getFilePath('originals', storageKey)).size,
      });
      ids.push(video.id);
      transcoding.enqueue(video.id);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      console.error(`[demo-seed] ${error.message}`);
    }
  }
  return ids;
}

async function waitForProcessing(ids, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const states = ids.map((id) => videos.findById(id)?.processing_status);
    if (states.every((status) => status === 'ready' || status === 'failed')) return states;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for demo transcodes');
}

module.exports = { seedDemoIfEmpty, waitForProcessing };
