'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { getDatabase } = require('../config/database');
const videos = require('../repositories/videoRepository');
const storage = require('./storageService');
const cache = require('./cacheService');
const { getMetadata, validateVideoFile, getSupportedResolutions } = require('../utils/ffprobeHelper');

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || (fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : ffmpegStatic));

const pending = [];
const queued = new Set();
let running = false;

function runFfmpeg(inputPath, outputPath, options) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath).outputOptions(options).on('end', resolve).on('error', reject).save(outputPath);
    command = null;
  });
}

async function createVariant(video, metadata, quality, format) {
  const height = Number.parseInt(quality, 10);
  const key = `${video.id}-${quality}.${format}`;
  const outputPath = storage.getFilePath('transcoded', key);
  const scale = `scale=-2:${Math.min(height, metadata.height)}`;
  const options = format === 'mp4'
    ? ['-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-threads', '1']
    : ['-vf', scale, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '38', '-c:a', 'libopus', '-threads', '1'];
  try {
    await runFfmpeg(storage.getFilePath('originals', video.storage_key), outputPath, options);
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }
  const stat = fs.statSync(outputPath);
  const codec = format === 'mp4' ? 'h264/aac' : 'vp9/opus';
  videos.addVariant({ videoId: video.id, quality, format, codec, storageKey: key, fileSize: stat.size });
}

async function processVideo(videoId) {
  const db = getDatabase();
  const video = videos.findById(videoId);
  if (!video) return;
  db.prepare(`INSERT INTO processing_jobs(video_id, status, attempts, updated_at) VALUES (?, 'processing', 1, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id) DO UPDATE SET status = 'processing', attempts = attempts + 1, error_message = NULL, updated_at = CURRENT_TIMESTAMP`).run(videoId);
  videos.updateStatus(videoId, 'processing');
  const generated = [];
  let thumbnailKey;
  try {
    const sourcePath = storage.getFilePath('originals', video.storage_key);
    await validateVideoFile(sourcePath);
    const metadata = await getMetadata(sourcePath);
    thumbnailKey = `${video.id}.jpg`;
    const thumbnailPath = storage.getFilePath('thumbnails', thumbnailKey);
    await new Promise((resolve, reject) => {
      ffmpeg(sourcePath).screenshots({ count: 1, folder: path.dirname(thumbnailPath), filename: path.basename(thumbnailPath), size: '640x360' })
        .on('end', resolve).on('error', reject);
    });
    getDatabase().prepare('UPDATE videos SET thumbnail_key = ?, duration = ? WHERE id = ?').run(thumbnailKey, metadata.duration, videoId);
    const resolutions = getSupportedResolutions(metadata.height);
    const mp4Qualities = resolutions.includes('360p') ? ['360p'] : [resolutions[0]].filter(Boolean);
    if (resolutions.includes('720p')) mp4Qualities.push('720p');
    for (const quality of [...new Set(mp4Qualities)]) {
      await createVariant(video, metadata, quality, 'mp4');
      generated.push(`${videoId}-${quality}.mp4`);
    }
    if (mp4Qualities.length) {
      await createVariant(video, metadata, mp4Qualities[0], 'webm');
      generated.push(`${videoId}-${mp4Qualities[0]}.webm`);
    }
    videos.updateStatus(videoId, 'ready');
    db.prepare("UPDATE processing_jobs SET status = 'ready', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE video_id = ?").run(videoId);
    cache.invalidateVideo(videoId);
  } catch (error) {
    for (const key of generated) storage.deleteFile('transcoded', key);
    if (thumbnailKey) storage.deleteFile('thumbnails', thumbnailKey);
    db.prepare('DELETE FROM video_variants WHERE video_id = ?').run(videoId);
    videos.updateStatus(videoId, 'failed');
    cache.invalidateVideo(videoId);
    db.prepare("UPDATE processing_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE video_id = ?")
      .run(String(error.message).slice(0, 1000), videoId);
    console.error(`[transcoding] Video ${videoId} failed: ${error.message}`);
  }
}

async function drain() {
  if (running) return;
  running = true;
  while (pending.length) {
    const id = pending.shift();
    queued.delete(id);
    await processVideo(id);
  }
  running = false;
}

function enqueue(videoId) {
  const id = Number(videoId);
  if (!queued.has(id)) {
    queued.add(id);
    pending.push(id);
    setImmediate(drain);
  }
}

function resumePending() {
  const jobs = getDatabase().prepare("SELECT video_id FROM processing_jobs WHERE status IN ('queued', 'processing', 'failed') ORDER BY id").all();
  for (const job of jobs) enqueue(job.video_id);
}

module.exports = { enqueue, resumePending, processVideo, getQueueLength: () => pending.length + (running ? 1 : 0) };