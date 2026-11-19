'use strict';

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v'];

// Bytes that identify common video container formats (magic bytes / file signatures)
// Each entry: { ext, offset, bytes (hex strings) }
const MAGIC_SIGNATURES = [
  // MP4 / M4V / MOV  — ftyp box at offset 4
  { label: 'mp4/m4v/mov', offset: 4,  hex: '66747970' },   // "ftyp"
  // WEBM / MKV — EBML header
  { label: 'mkv/webm',    offset: 0,  hex: '1a45dfa3' },
  // AVI  — RIFF + AVI
  { label: 'avi',         offset: 0,  hex: '52494646' },   // "RIFF"
  // FLV
  { label: 'flv',         offset: 0,  hex: '464c5601' },
  // MPEG-TS
  { label: 'ts',          offset: 0,  hex: '47'       },
];

// MIME types that are acceptable for video uploads
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/x-matroska',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/avi',
  'video/x-m4v',
  'video/mpeg',
  'application/octet-stream', // some browsers send this for .mkv
]);

// Max upload size from env, default 500 MB
const UPLOAD_MAX_SIZE_BYTES = (() => {
  const mb = parseInt(process.env.MAX_UPLOAD_MB || process.env.UPLOAD_MAX_SIZE_MB, 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a small header from the file at the given byte offset.
 * @param {string} filePath
 * @param {number} offset
 * @param {number} length  bytes to read
 * @returns {Buffer}
 */
function readBytes(filePath, offset, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Detect whether the file at filePath looks like a video by its magic bytes.
 * @param {string} filePath
 * @returns {boolean}
 */
function validateMimeType(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 12) return false;

    for (const sig of MAGIC_SIGNATURES) {
      const needed = sig.hex.length / 2;
      const buf = readBytes(filePath, sig.offset, needed);
      if (buf.toString('hex').startsWith(sig.hex)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full validation of an upload.
 * @param {{ path: string, originalname: string, mimetype: string, size: number }} file
 *   Multer file object (or equivalent).
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateUpload(file) {
  if (!file) return { valid: false, error: 'No file provided.' };

  // 1. Extension check
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `File extension "${ext}" is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  // 2. MIME type (reported by browser — not authoritative but useful pre-filter)
  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    // Soft warning only — don't reject on MIME alone because browsers lie.
    // We rely on magic bytes instead.
  }

  // 3. File size
  const size = file.size != null ? file.size : (fs.existsSync(file.path) ? fs.statSync(file.path).size : 0);
  if (size > UPLOAD_MAX_SIZE_BYTES) {
    const limitMB = Math.round(UPLOAD_MAX_SIZE_BYTES / 1024 / 1024);
    return {
      valid: false,
      error: `File size ${(size / 1024 / 1024).toFixed(1)} MB exceeds the ${limitMB} MB limit.`,
    };
  }

  // 4. Magic-byte check (only when file exists on disk)
  if (file.path && fs.existsSync(file.path)) {
    if (!validateMimeType(file.path)) {
      return { valid: false, error: 'File does not appear to be a valid video (magic bytes mismatch).' };
    }
  }

  return { valid: true, error: null };
}

module.exports = {
  validateMimeType,
  validateUpload,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  UPLOAD_MAX_SIZE_BYTES,
};
