'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const path = require('path');
const fs = require('fs');

// Use ffmpeg-static binary
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || (fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : ffmpegStatic));
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || (fs.existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : (ffprobeStatic.path || ffprobeStatic)));

// Resolution ladder (ascending)
const RESOLUTION_LADDER = [
  { name: '240p',  height: 240  },
  { name: '360p',  height: 360  },
  { name: '480p',  height: 480  },
  { name: '720p',  height: 720  },
  { name: '1080p', height: 1080 },
];

/**
 * Probe a video file and return metadata.
 * @param {string} filePath - Absolute path to the video file.
 * @returns {Promise<{duration, width, height, codec, bitrate, format, size}>}
 */
function getMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe error for "${filePath}": ${err.message}`));

      const format = metadata.format || {};
      const videoStream = (metadata.streams || []).find(s => s.codec_type === 'video') || {};
      const audioStream = (metadata.streams || []).find(s => s.codec_type === 'audio') || {};

      resolve({
        duration:   parseFloat(format.duration) || 0,
        width:      videoStream.width  || 0,
        height:     videoStream.height || 0,
        codec:      videoStream.codec_name || null,
        bitrate:    parseInt(format.bit_rate, 10) || 0,
        format:     format.format_name || null,
        size:       parseInt(format.size, 10) || 0,
        audioCodec: audioStream.codec_name || null,
      });
    });
  });
}

/**
 * Validate that the file is a playable video. Throws on failure.
 * @param {string} filePath
 */
async function validateVideoFile(filePath) {
  let meta;
  try {
    meta = await getMetadata(filePath);
  } catch (err) {
    throw new Error(`Not a valid video file: ${err.message}`);
  }

  if (!meta.duration || meta.duration <= 0) {
    throw new Error(`Video has no duration: "${filePath}"`);
  }
  if (!meta.width || !meta.height) {
    throw new Error(`Video has no video stream: "${filePath}"`);
  }
}

/**
 * Returns an array of target resolution names that do not exceed the source height.
 * Never upscales.
 * @param {number} sourceHeight
 * @returns {string[]} e.g. ['240p', '360p', '480p'] for a 540p source
 */
function getSupportedResolutions(sourceHeight) {
  return RESOLUTION_LADDER
    .filter(r => r.height <= sourceHeight)
    .map(r => r.name);
}

module.exports = { getMetadata, validateVideoFile, getSupportedResolutions, RESOLUTION_LADDER };
