'use strict';

const { getDatabase } = require('../config/database');
const cache = require('./cacheService');

function tokens(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function recommend(userId, currentVideoId = null, limit = 12) {
  const key = `recommendations:${userId}:${currentVideoId || 'all'}:${limit}`;
  return cache.get(key, () => {
    const db = getDatabase();
    const candidates = db.prepare("SELECT * FROM videos WHERE processing_status = 'ready' AND id != COALESCE(?, -1)").all(currentVideoId ? Number(currentVideoId) : null);
    if (!candidates.length) return [];
    const history = db.prepare(`SELECT v.*, h.completed, h.progress_seconds FROM watch_history h
      JOIN videos v ON v.id = h.video_id WHERE h.user_id = ? AND v.processing_status = 'ready'`).all(Number(userId));
    const historyIds = new Set(history.map((item) => item.id));
    const popularityMax = Math.max(1, ...candidates.map((item) => item.view_count));
    const newest = Math.max(...candidates.map((item) => Date.parse(`${item.created_at.replace(' ', 'T')}Z`)));
    const pref = new Set();
    for (const watched of history) {
      let watchedTags = [];
      try { watchedTags = JSON.parse(watched.tags); } catch { watchedTags = []; }
      for (const tag of watchedTags) pref.add(String(tag).toLowerCase());
    }
    return candidates.filter((video) => !historyIds.has(video.id) || !history.find((item) => item.id === video.id)?.completed)
      .map((video) => {
        let tags = [];
        try { tags = JSON.parse(video.tags); } catch { tags = []; }
        const content = tokens(`${video.title} ${video.description} ${tags.join(' ')}`);
        const similarity = history.length ? Math.max(...history.map((watched) => {
          let watchedTags = [];
          try { watchedTags = JSON.parse(watched.tags); } catch { watchedTags = []; }
          const weight = watched.completed ? 1 : 0.45;
          return weight * jaccard(content, tokens(`${watched.title} ${watched.description} ${watchedTags.join(' ')}`));
        })) : 0;
        const preference = tags.length ? tags.filter((tag) => pref.has(String(tag).toLowerCase())).length / tags.length : 0;
        const popularity = Math.min(1, video.view_count / popularityMax);
        const age = Math.max(0, newest - Date.parse(`${video.created_at.replace(' ', 'T')}Z`));
        const recency = 1 / (1 + age / (30 * 24 * 60 * 60 * 1000));
        const score = history.length
          ? 0.45 * similarity + 0.25 * preference + 0.2 * popularity + 0.1 * recency
          : 0.7 * popularity + 0.3 * recency;
        const reason = similarity > 0.15 ? 'Similar to videos you enjoyed'
          : preference > 0 ? `Recommended because you watched ${tags[0]} videos`
            : popularity > 0.5 ? 'Popular in your library' : 'Recently added';
        return { videoId: video.id, title: video.title, score: Number(score.toFixed(5)), reason };
      })
      .sort((a, b) => b.score - a.score || a.videoId - b.videoId)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 12)));
  });
}

module.exports = { recommend, jaccard, tokens };