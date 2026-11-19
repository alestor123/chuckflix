# Chuckflix

Chuckflix is a self-hosted video library built with Node.js, Express, EJS, SQLite, and FFmpeg. Admins upload videos; the application validates and stores them locally, generates thumbnails and MP4/WebM playback variants, and serves authenticated byte-range streams.

## Features

- Viewer signup, bcrypt password hashes, admin roles, SQLite-backed expiring sessions, and CSRF protection
- Private local media storage and validated streaming uploads
- FFprobe validation, thumbnails, and serial FFmpeg transcoding without upscaling
- Authenticated byte-range playback with quality/format switching and saved watch progress
- Deterministic personalized and cold-start recommendations
- Bounded TTL LRU cache with protected hit/miss/eviction metrics
- One-container Docker deployment and a Render Blueprint
- Optional original synthetic demo clips (`SEED_DEMO=true` or `npm run seed`)

## Architecture

```text
Browser (EJS)
    |
    v
Express modular monolith
  |-- auth/session and route middleware
  |-- user/video repositories --> SQLite (users, media, jobs, history, sessions)
  |-- storage service ----------> DATA_DIR (originals, variants, thumbnails)
  |-- media processor ----------> FFmpeg / FFprobe
  |-- recommendation service ---> deterministic ranking
  `-- cache service ------------> bounded in-process LRU
```

These are logical modules in one process, not independently deployed microservices. Storage is filesystem-backed, not cloud object storage. The cache is in-process, not Redis.

## Local Setup

Requires Node.js 22+ and FFmpeg/FFprobe, or use Docker.

```sh
npm ci
cp .env.example .env
```

Set a private `SESSION_SECRET` in `.env`, then create an administrator and start the app:

```sh
npm run create-admin -- admin 'use-a-unique-password-of-12-chars-or-more'
npm start
```

Open `http://localhost:10000`. SQLite and media are stored under `DATA_DIR` (default `./data`). Viewer accounts can also register at `/signup`.

## Docker

Set `SESSION_SECRET` in `.env`, then run:

```sh
docker compose up --build -d
```

For a standalone container:

```sh
docker build -t chuckflix .
docker run -p 10000:10000 --env-file .env -v chuckflix_data:/app/data chuckflix
```

To bootstrap an administrator on first startup, provide `ADMIN_USERNAME` and `ADMIN_PASSWORD` (minimum 12 characters) as private environment variables. The password is never printed. `npm run seed` creates small original synthetic clips and transcodes them; `SEED_DEMO=true` does this in the background on startup only when the library is empty.

## Render

1. Push the repository to GitHub.
2. In Render, create a Blueprint from the repository or create a Docker Web Service using the supplied `Dockerfile`.
3. Configure `SESSION_SECRET` (the Blueprint generates one). Add `ADMIN_USERNAME` and `ADMIN_PASSWORD` as secret environment variables to bootstrap the first admin.
4. Deploy and open the service URL. `/healthz` is the health endpoint.

The Free service uses container-local, ephemeral storage. SQLite data and uploaded media can be lost when Render replaces the instance. The app has no MongoDB, Redis, Telegram, or cloud-storage dependency.

## Interview Demo

1. Sign in as the configured admin and upload a small MP4/MOV/MKV/WebM file.
2. Show the queued/processing/ready status, generated thumbnail, and available MP4/WebM variants.
3. Sign in as a viewer, seek in playback, switch to another available variant, and inspect saved progress.
4. Browse recommendation and trending shelves; `GET /api/recommendations` returns calculated scores and reasons.
5. As admin, inspect `GET /admin/system`, request a page twice to see cache hits, and clear the cache with `POST /admin/cache/clear`.
6. Run `npm test` and show the single-container Docker configuration.

## Tests

```sh
npm test
```

The integration suite exercises SQLite schema and sessions, signup/password hashing, CSRF, a real synthetic upload/transcode, MP4/WebM variants, authenticated range responses, watch progress, recommendations/cache behavior, and health. Docker image build/run checks must additionally be run with Docker installed.

## Limitations

- Modular monolith, not distributed microservices
- Local filesystem-backed storage, not S3 or cloud object storage
- Explainable tag/text recommendation scoring, not trained machine learning
- In-memory metadata LRU, not a distributed cache
- One in-process transcoding job at a time
- Render Free storage is ephemeral; no persistent disk is provisioned

## Resume

Built a Node.js/Express media platform with SQLite-backed authentication and sessions, private local video storage, FFmpeg MP4/WebM transcoding, and authenticated HTTP range streaming; implemented deterministic content-based recommendations and observable TTL LRU caching in a Dockerized modular monolith.