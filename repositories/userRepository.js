'use strict';

const bcrypt = require('bcryptjs');
const { getDatabase } = require('../config/database');

function mapUser(row) {
  return row && { id: row.id, _id: String(row.id), username: row.username, password: row.password_hash, role: row.role, createdAt: new Date(row.created_at) };
}

function findByUsername(username) {
  const row = getDatabase().prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  const user = mapUser(row);
  if (user) user.comparePassword = (password) => bcrypt.compare(password, user.password);
  return user;
}

function create({ username, password, role = 'viewer' }) {
  const normalized = String(username || '').trim();
  const hash = bcrypt.hashSync(password, 10);
  const result = getDatabase().prepare('INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)')
    .run(normalized, hash, role === 'admin' ? 'admin' : 'viewer');
  return findById(result.lastInsertRowid);
}

function findById(id) {
  const row = getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  const user = mapUser(row);
  if (user) user.comparePassword = (password) => bcrypt.compare(password, user.password);
  return user;
}

module.exports = { findByUsername, findById, create };