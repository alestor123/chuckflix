'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuckflix-test-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-length';
process.env.MAX_UPLOAD_MB = '10';

const { connectDB, getDatabase, closeDB } = require('../config/database');
connectDB();
const users = require('../repositories/userRepository');
const videos = require('../repositories/videoRepository');
const storage = require('../services/storageService');
const cache = require('../services/cacheService');
const recommendations = require('../services/recommendationService');
const transcoding = require('../services/transcodingService');
const app = require('../app');
const ffmpeg = require('ffmpeg-static');
let server;
let baseUrl;

function getCookie(response) {
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

function getCsrf(html) {
  const match = /name="csrfToken" value="([a-f0-9]+)"/.exec(html);
  assert.ok(match, 'CSRF token is present in rendered form');
  return match[1];
}

async function login(username, password) {
  const page = await fetch(`${baseUrl}/login`);
  const cookie = getCookie(page);
  const token = getCsrf(await page.text());
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, csrfToken: token }),
  });
  return { response, cookie: getCookie(response) };
}

before(async () => {
  const generated = spawnSync(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=12', '-t', '1', '-pix_fmt', 'yuv420p', '-y', path.join(dataDir, 'source.mp4')], { stdio: 'ignore' });
  assert.equal(generated.status, 0, 'FFmpeg creates a small synthetic video');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  users.create({ username: 'admin-test', password: 'strong-test-password', role: 'admin' });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDB();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('SQLite initializes users, videos, variants, history, jobs, and sessions', () => {
  const names = getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  for (const name of ['users', 'videos', 'video_variants', 'watch_history', 'processing_jobs', 'sessions']) assert.ok(names.includes(name));
});

test('viewer signup, password hashing, CSRF, and persistent SQLite session', async () => {
  const page = await fetch(`${baseUrl}/signup`);
  const cookie = getCookie(page);
  const token = getCsrf(await page.text());
  const denied = await fetch(`${baseUrl}/signup`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'viewer-test', password: 'viewer-pass', confirmPassword: 'viewer-pass' }), redirect: 'manual' });
  assert.equal(denied.status, 403);
  const response = await fetch(`${baseUrl}/signup`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'viewer-test', password: 'viewer-pass', confirmPassword: 'viewer-pass', role: 'admin', csrfToken: token }),
  });
  assert.equal(response.status, 302);
  const sessionCookie = getCookie(response);
  assert.ok(sessionCookie);
  const stored = getDatabase().prepare('SELECT sess FROM sessions').get();
  assert.ok(stored);
  const user = users.findByUsername('viewer-test');
  assert.notEqual(user.password, 'viewer-pass');
  assert.equal(await user.comparePassword('viewer-pass'), true);
  assert.equal(user.role, 'viewer');
  const browse = await fetch(`${baseUrl}/viewer/browse`, { headers: { cookie: sessionCookie } });
  assert.equal(browse.status, 200);
});

test('admin authentication, real transcodes, protected range streaming, progress, and recommendations', async () => {
  const loginResult = await login('admin-test', 'strong-test-password');
  assert.equal(loginResult.response.status, 302);
  const adminCookie = loginResult.cookie;
  const dashboard = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie: adminCookie } });
  const adminToken = getCsrf(await dashboard.text());
  const invalidForm = new FormData();
  invalidForm.set('title', 'Invalid upload');
  invalidForm.set('csrfToken', adminToken);
  invalidForm.set('video', new Blob(['not a video'], { type: 'video/mp4' }), 'invalid.mp4');
  const invalidUpload = await fetch(`${baseUrl}/admin/upload`, { method: 'POST', headers: { cookie: adminCookie }, body: invalidForm, redirect: 'manual' });
  assert.equal(invalidUpload.status, 302);
  assert.equal(videos.listAll().length, 0);
  const form = new FormData();
  form.set('title', 'Synthetic Science');
  form.set('description', 'Original testsrc video about science');
  form.set('tags', 'science, technology');
  form.set('csrfToken', adminToken);
  form.set('video', new Blob([fs.readFileSync(path.join(dataDir, 'source.mp4'))], { type: 'video/mp4' }), 'synthetic.mp4');
  const uploadResponse = await fetch(`${baseUrl}/admin/upload`, { method: 'POST', headers: { cookie: adminCookie }, body: form, redirect: 'manual' });
  assert.equal(uploadResponse.status, 302);
  const uploaded = videos.listAll()[0];
  assert.ok(uploaded);
  for (let tries = 0; tries < 200 && videos.findById(uploaded.id).processing_status === 'queued'; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (let tries = 0; tries < 200 && videos.findById(uploaded.id).processing_status === 'processing'; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ready = videos.findById(uploaded.id);
  assert.equal(ready.processing_status, 'ready');
  assert.ok(storage.fileExists('thumbnails', ready.thumbnail_key));
  const variants = videos.variants(uploaded.id);
  assert.ok(variants.some((variant) => variant.format === 'mp4'));
  assert.ok(variants.some((variant) => variant.format === 'webm'));
  for (const variant of variants) assert.ok(storage.fileExists('transcoded', variant.storage_key));
  const watchPage = await fetch(`${baseUrl}/viewer/watch/${uploaded.id}`, { headers: { cookie: adminCookie } });
  assert.equal(watchPage.status, 200);
  assert.match(await watchPage.text(), /variantSelect/);
  const viewsAfterOpen = videos.findById(uploaded.id).views;
  await fetch(`${baseUrl}/viewer/watch/${uploaded.id}`, { headers: { cookie: adminCookie } });
  assert.equal(videos.findById(uploaded.id).views, viewsAfterOpen);

  const mp4 = variants.find((variant) => variant.format === 'mp4');
  const stream = await fetch(`${baseUrl}/viewer/stream/${uploaded.id}/${mp4.id}`, { headers: { cookie: adminCookie, range: 'bytes=0-99' } });
  assert.equal(stream.status, 206);
  assert.equal(stream.headers.get('content-range'), `bytes 0-99/${mp4.file_size}`);
  assert.equal((await stream.arrayBuffer()).byteLength, 100);
  const fullStream = await fetch(`${baseUrl}/viewer/stream/${uploaded.id}/${mp4.id}`, { headers: { cookie: adminCookie } });
  assert.equal(fullStream.status, 200);
  await fullStream.arrayBuffer();
  const invalidRange = await fetch(`${baseUrl}/viewer/stream/${uploaded.id}/${mp4.id}`, { headers: { cookie: adminCookie, range: 'bytes=999999999-' } });
  assert.equal(invalidRange.status, 416);
  const unauthorized = await fetch(`${baseUrl}/viewer/stream/${uploaded.id}/${mp4.id}`, { redirect: 'manual' });
  assert.equal(unauthorized.status, 302);

  const viewerLogin = await login('viewer-test', 'viewer-pass');
  const viewerCookie = viewerLogin.cookie;
  const viewerUpload = await fetch(`${baseUrl}/admin/upload`, { method: 'POST', headers: { cookie: viewerCookie }, body: new FormData(), redirect: 'manual' });
  assert.equal(viewerUpload.status, 403);
  const browse = await fetch(`${baseUrl}/viewer/browse`, { headers: { cookie: viewerCookie } });
  const viewerToken = getCsrf(await browse.text());
  const progress = await fetch(`${baseUrl}/viewer/progress/${uploaded.id}`, {
    method: 'POST', headers: { cookie: viewerCookie, 'content-type': 'application/json', 'x-csrf-token': viewerToken },
    body: JSON.stringify({ progressSeconds: 0.6, completed: true }),
  });
  assert.equal(progress.status, 200);
  assert.equal(getDatabase().prepare('SELECT completed FROM watch_history WHERE user_id = ? AND video_id = ?').get(userId('viewer-test'), uploaded.id).completed, 1);
  const firstRecommendations = await fetch(`${baseUrl}/api/recommendations`, { headers: { cookie: viewerCookie } });
  assert.equal(firstRecommendations.status, 200);
  assert.ok(Array.isArray((await firstRecommendations.json()).recommendations));
  const repeatedRecommendations = await fetch(`${baseUrl}/api/recommendations`, { headers: { cookie: viewerCookie } });
  assert.equal(repeatedRecommendations.status, 200);
  await repeatedRecommendations.arrayBuffer();

  const systemPage = await fetch(`${baseUrl}/admin/system`, { headers: { cookie: adminCookie } });
  assert.equal(systemPage.status, 200);
  assert.match(await systemPage.text(), /Clear Metadata Cache/);
  const clearCache = await fetch(`${baseUrl}/admin/cache/clear`, {
    method: 'POST', redirect: 'manual', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: adminToken }),
  });
  assert.equal(clearCache.status, 302);

  const deleteResponse = await fetch(`${baseUrl}/admin/delete/${uploaded.id}`, {
    method: 'POST', redirect: 'manual', headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: adminToken }),
  });
  assert.equal(deleteResponse.status, 302);
  assert.equal(videos.findById(uploaded.id), null);
  assert.equal(storage.fileExists('originals', uploaded.storage_key), false);
});

test('recommendations are deterministic and cache records hits, misses, and invalidation', () => {
  const secondVideo = videos.create({ title: 'More Science', description: 'Another technology experiment', tags: ['science', 'technology'], originalFilename: 'sample.mp4', storageKey: 'recommendation-only.mp4', fileSize: 1 });
  videos.updateStatus(secondVideo.id, 'ready');
  users.create({ username: 'cold-start', password: 'cold-start-password' });
  cache.clear();
  const first = recommendations.recommend(userId('viewer-test'));
  const second = recommendations.recommend(userId('viewer-test'));
  assert.ok(first.some((item) => item.videoId === secondVideo.id));
  assert.deepEqual(second, first);
  assert.ok(recommendations.recommend(userId('cold-start')).length > 0);
  const before = cache.stats();
  assert.ok(before.hits >= 1);
  assert.ok(before.misses >= 1);
  cache.invalidateUser(userId('viewer-test'));
  const after = cache.stats();
  assert.ok(after.entries < before.entries);
});

test('health endpoint is available and reports ready', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

function userId(username) {
  return users.findByUsername(username).id;
}
