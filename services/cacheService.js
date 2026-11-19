'use strict';

const { LRUCache } = require('lru-cache');

const metrics = { hits: 0, misses: 0, evictions: 0 };
const cache = new LRUCache({
  max: Math.max(10, Number(process.env.CACHE_MAX_SIZE) || 200),
  ttl: Math.max(10, Number(process.env.CACHE_TTL) || 300) * 1000,
  dispose: (_value, _key, reason) => {
    if (reason === 'evict') metrics.evictions += 1;
  },
});

function get(key, loader) {
  if (cache.has(key)) {
    metrics.hits += 1;
    return cache.get(key);
  }
  metrics.misses += 1;
  const value = loader();
  cache.set(key, value);
  return value;
}

function invalidateVideo(videoId) {
  for (const key of cache.keys()) {
    if (key.startsWith('browse:') || key.startsWith('trending') || key === `video:${videoId}` || key.startsWith('recommendations:')) cache.delete(key);
  }
}

function invalidateUser(userId) {
  const prefix = `recommendations:${userId}:`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  cache.delete(`continue:${userId}`);
}

function clear() {
  cache.clear();
}

function stats() {
  const total = metrics.hits + metrics.misses;
  return { ...metrics, entries: cache.size, hitRate: total ? metrics.hits / total : 0 };
}

module.exports = { get, invalidateVideo, invalidateUser, clear, stats };