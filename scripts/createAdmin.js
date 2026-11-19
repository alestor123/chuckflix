'use strict';

require('dotenv').config();
const { connectDB, closeDB } = require('../config/database');
const users = require('../repositories/userRepository');

const username = process.argv[2] || process.env.ADMIN_USERNAME;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
if (!username || !password || password.length < 12) {
  console.error('Usage: npm run create-admin -- <username> <password> (password must be at least 12 characters)');
  process.exitCode = 1;
} else {
  try {
    connectDB();
    if (users.findByUsername(username)) throw new Error(`User ${username} already exists`);
    users.create({ username, password, role: 'admin' });
    console.log(`Admin account ${username} created.`);
  } catch (error) {
    console.error(`[create-admin] ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDB();
  }
}