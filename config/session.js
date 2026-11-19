'use strict';

const session = require('express-session');
const Store = session.Store;
const config = require('./environment');
const { getDatabase } = require('./database');

class SQLiteStore extends Store {
  constructor() {
    super();
    this.db = getDatabase();
    this.db.prepare('DELETE FROM sessions WHERE expired <= ?').run(Date.now());
    this.cleanupTimer = setInterval(() => {
      this.db.prepare('DELETE FROM sessions WHERE expired <= ?').run(Date.now());
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expired <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + config.sessionMaxAge;
      this.db.prepare(`INSERT INTO sessions(sid, sess, expired) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`)
        .run(sid, JSON.stringify(sess), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expiresAt = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + config.sessionMaxAge;
      this.db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expiresAt, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

const store = new SQLiteStore();
const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store,
  cookie: {
    secure: config.isProduction,   // HTTPS only in prod
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionMaxAge,
  },
  name: 'chuckflix.sid',
});

module.exports = sessionMiddleware;
module.exports.SQLiteStore = SQLiteStore;
module.exports.store = store;
