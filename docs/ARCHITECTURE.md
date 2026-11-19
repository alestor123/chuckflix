# Chuckflix Architecture

Chuckflix is a single Node.js/Express process organized as a modular monolith. Its modules are logical service boundaries, not independently deployed microservices.

```text
EJS browser
   |
   v
Express routes + auth/CSRF/security middleware
   |-- userRepository / videoRepository --> SQLite (DATA_DIR/chuckflix.sqlite)
   |-- SQLite session store -------------> sessions table with expiry cleanup
   |-- storageService --------------------> DATA_DIR/originals, transcoded, thumbnails
   |-- transcodingService ----------------> serial FFmpeg/FFprobe jobs in SQLite
   |-- recommendationService -------------> explainable per-user ranking
   `-- cacheService ----------------------> bounded TTL LRU in this process
```

## Persistence

`DATA_DIR` defaults to `./data` locally and is `/app/data` in Docker. SQLite enables foreign keys and WAL mode. Schema version 1 is created automatically and includes users, videos, variants, watch history, processing jobs, and sessions. The repositories use prepared statements. Session expiration is stored in the same database and expired rows are periodically deleted.

The data directory contains the SQLite database and private media subdirectories. Video content is never exposed by Express static middleware. Authenticated routes resolve generated storage keys through `storageService`.

## Upload and Playback

Uploads stream to a temporary file using Multer limits, then pass extension, size, magic-byte, and FFprobe checks. Valid originals are moved into local storage and recorded with a queued SQLite job. A single in-process worker resumes queued/interrupted work on startup, creates a thumbnail, and writes non-upscaled H.264/AAC MP4 and VP9/Opus WebM variants. Only completed variants are offered to the player.

Playback is authenticated and uses ordinary progressive MP4/WebM files. The stream route supports full responses and validated byte ranges, including `206` and `416`; media is read through filesystem streams rather than buffered into RAM.

## Recommendations and Cache

Recommendations combine tag/text Jaccard similarity, completion-weighted viewing history, popularity, and recency. A user with no history receives a deterministic popularity/recency cold start. Completed titles are excluded from recommendation candidates. Reasons are returned with real calculated scores.

`cacheService` stores lightweight browse, trending, and per-user recommendation results in a bounded TTL LRU. It reports hits, misses, hit rate, entry count, and capacity evictions. Upload completion, deletion, and watch-history updates invalidate related entries. Video bytes and session data are not stored in this cache.

## Deployment Boundaries

Docker contains Express, SQLite, FFmpeg/FFprobe, media processing, local storage, recommendations, and cache in one non-root container. Compose adds only a named volume for `/app/data`; Render uses the same Dockerfile without provisioning a paid disk. Render Free storage is ephemeral and can be lost when an instance is replaced.

Local filesystem storage is an object-storage-style abstraction only. It is not S3-compatible cloud storage. The cache is process-local, not Redis. See the root README for setup and deployment commands.