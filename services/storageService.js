'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('../config/database');

const roots = {
  originals: path.join(dataDir, 'originals'),
  transcoded: path.join(dataDir, 'transcoded'),
  thumbnails: path.join(dataDir, 'thumbnails'),
  temp: path.join(dataDir, 'temp'),
};

for (const directory of Object.values(roots)) fs.mkdirSync(directory, { recursive: true, mode: 0o750 });

function safePath(area, key) {
  if (!roots[area] || typeof key !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(key) || key.includes('..')) {
    throw new Error('Invalid storage key');
  }
  return path.join(roots[area], key);
}

function createKey(extension = '') {
  const suffix = /^\.[a-zA-Z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '';
  return `${crypto.randomUUID()}${suffix}`;
}

function putFile(sourcePath, area, key = createKey(path.extname(sourcePath))) {
  const destination = safePath(area, key);
  fs.renameSync(sourcePath, destination);
  return key;
}

function getFilePath(area, key) {
  return safePath(area, key);
}

function getReadStream(area, key, options) {
  return fs.createReadStream(safePath(area, key), options);
}

function fileExists(area, key) {
  try { return fs.statSync(safePath(area, key)).isFile(); } catch { return false; }
}

function getFileMetadata(area, key) {
  return fs.statSync(safePath(area, key));
}

function deleteFile(area, key) {
  const filePath = safePath(area, key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { roots, createKey, putFile, getFilePath, getReadStream, fileExists, getFileMetadata, deleteFile };