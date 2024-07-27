const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const generateThumbnail = (videoPath, outputPath, timeOffset = '00:00:05') => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timeOffset],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '1280x720'
      })
      .on('end', () => {
        console.log('Thumbnail generated successfully');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(err);
      });
  });
};

const getVideoDuration = (videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const duration = metadata.format.duration;
        resolve(Math.floor(duration));
      }
    });
  });
};

module.exports = { generateThumbnail, getVideoDuration };
