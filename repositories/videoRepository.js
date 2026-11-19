'use strict';

const { getDatabase } = require('../config/database');

function mapVideo(row) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch { tags = []; }
  return {
    ...row,
    _id: String(row.id),
    filename: row.storage_key,
    originalName: row.original_filename,
    thumbnailPath: row.thumbnail_key ? `media/${row.thumbnail_key}` : null,
    uploadDate: new Date(`${row.created_at.replace(' ', 'T')}Z`),
    views: row.view_count,
    fileSize: row.file_size,
    tags,
  };
}

function list({ search = '' } = {}) {
  const db = getDatabase();
  const rows = search
    ? db.prepare(`SELECT * FROM videos WHERE processing_status = 'ready'
      AND (title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR tags LIKE ? COLLATE NOCASE)
      ORDER BY created_at DESC`).all(`%${search}%`, `%${search}%`, `%${search}%`)
    : db.prepare("SELECT * FROM videos WHERE processing_status = 'ready' ORDER BY created_at DESC").all();
  return rows.map(mapVideo);
}

function listAll() {
  return getDatabase().prepare('SELECT * FROM videos ORDER BY created_at DESC').all().map(mapVideo);
}

function findById(id) {
  if (!/^\d+$/.test(String(id))) return null;
  return mapVideo(getDatabase().prepare('SELECT * FROM videos WHERE id = ?').get(Number(id)));
}

function create(video) {
  const db = getDatabase();
  const insert = db.transaction(() => {
    const result = db.prepare(`INSERT INTO videos
      (title, description, tags, original_filename, storage_key, thumbnail_key, duration, file_size, processing_status)
      VALUES (@title, @description, @tags, @originalFilename, @storageKey, @thumbnailKey, @duration, @fileSize, @status)`)
      .run({
        title: video.title,
        description: video.description || '',
        tags: JSON.stringify(video.tags || []),
        originalFilename: video.originalFilename,
        storageKey: video.storageKey,
        thumbnailKey: video.thumbnailKey || null,
        duration: video.duration || 0,
        fileSize: video.fileSize || 0,
        status: video.status || 'queued',
      });
    db.prepare('INSERT INTO processing_jobs(video_id, status) VALUES (?, ?)').run(result.lastInsertRowid, 'queued');
    return result.lastInsertRowid;
  });
  return findById(insert());
}

function updateStatus(id, status) {
  getDatabase().prepare('UPDATE videos SET processing_status = ? WHERE id = ?').run(status, Number(id));
}

function incrementViews(id) {
  getDatabase().prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ?').run(Number(id));
}

function recordViewOnce(userId, videoId) {
  const db = getDatabase();
  const record = db.transaction(() => {
    const inserted = db.prepare(`INSERT OR IGNORE INTO watch_history(user_id, video_id, progress_seconds, completed)
      VALUES (?, ?, 0, 0)`).run(Number(userId), Number(videoId));
    if (inserted.changes) incrementViews(videoId);
    return inserted.changes > 0;
  });
  return record();
}

function deleteById(id) {
  return getDatabase().prepare('DELETE FROM videos WHERE id = ?').run(Number(id)).changes > 0;
}

function variants(videoId) {
  return getDatabase().prepare('SELECT * FROM video_variants WHERE video_id = ? ORDER BY quality, format').all(Number(videoId));
}

function addVariant(variant) {
  getDatabase().prepare(`INSERT OR REPLACE INTO video_variants
    (video_id, quality, format, codec, storage_key, file_size)
    VALUES (@videoId, @quality, @format, @codec, @storageKey, @fileSize)`).run(variant);
}

function saveProgress(userId, videoId, progress, completed, countView = false) {
  const db = getDatabase();
  const update = db.transaction(() => {
    db.prepare(`INSERT INTO watch_history(user_id, video_id, progress_seconds, completed, last_watched_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, video_id) DO UPDATE SET progress_seconds = excluded.progress_seconds,
      completed = MAX(watch_history.completed, excluded.completed), last_watched_at = CURRENT_TIMESTAMP`)
      .run(Number(userId), Number(videoId), Math.max(0, Number(progress) || 0), completed ? 1 : 0);
    if (countView) db.prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ?').run(Number(videoId));
  });
  update();
}

function history(userId) {
  return getDatabase().prepare(`SELECT h.*, v.* FROM watch_history h JOIN videos v ON v.id = h.video_id
    WHERE h.user_id = ? AND v.processing_status = 'ready' ORDER BY h.last_watched_at DESC`).all(Number(userId));
}

function trending(limit = 8) {
  return getDatabase().prepare("SELECT * FROM videos WHERE processing_status = 'ready' ORDER BY view_count DESC, created_at DESC, id ASC LIMIT ?")
    .all(Math.max(1, Math.min(20, Number(limit) || 8))).map(mapVideo);
}

function continueWatching(userId, limit = 8) {
  const rows = getDatabase().prepare(`SELECT v.* FROM watch_history h JOIN videos v ON v.id = h.video_id
    WHERE h.user_id = ? AND h.completed = 0 AND h.progress_seconds > 0 AND v.processing_status = 'ready'
    ORDER BY h.last_watched_at DESC LIMIT ?`).all(Number(userId), Math.max(1, Math.min(20, Number(limit) || 8)));
  return rows.map(mapVideo);
}

module.exports = { list, listAll, findById, create, updateStatus, incrementViews, recordViewOnce, deleteById, variants, addVariant, saveProgress, history, trending, continueWatching, mapVideo };