'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const databasePath = path.join(dataDir, 'chuckflix.sqlite');
let database;

function initializeSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      original_filename TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      thumbnail_key TEXT,
      duration REAL NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      processing_status TEXT NOT NULL DEFAULT 'queued'
        CHECK (processing_status IN ('queued', 'processing', 'ready', 'failed')),
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS video_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      quality TEXT NOT NULL,
      format TEXT NOT NULL,
      codec TEXT NOT NULL DEFAULT '',
      storage_key TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL DEFAULT 0,
      UNIQUE(video_id, quality, format)
    );
    CREATE TABLE IF NOT EXISTS watch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      progress_seconds REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(processing_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_variants_video ON video_variants(video_id);
    CREATE INDEX IF NOT EXISTS idx_history_user_recent ON watch_history(user_id, last_watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_video ON watch_history(video_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
    INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
  `);
}

function connectDB() {
  if (database) return database;
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o750 });
  database = new Database(databasePath);
  database.pragma('busy_timeout = 5000');
  initializeSchema(database);
  return database;
}

function getDatabase() {
  if (!database) throw new Error('SQLite database has not been initialized');
  return database;
}

function isConnected() {
  return Boolean(database && database.open);
}

function closeDB() {
  if (database) database.close();
  database = undefined;
}

module.exports = { connectDB, getDatabase, isConnected, closeDB, databasePath, dataDir };
