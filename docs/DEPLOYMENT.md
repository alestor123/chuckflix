# Deployment

## Local Node

Use Node.js 22 or later. FFmpeg and FFprobe are bundled for development; the Docker image installs system binaries.

```sh
npm ci
cp .env.example .env
```

Set a private `SESSION_SECRET` in `.env`, then initialize an administrator and run:

```sh
npm run create-admin -- admin 'a-unique-password-of-at-least-12-chars'
npm start
```

The app listens on `0.0.0.0` and respects `PORT`. `DATA_DIR` defaults to `./data`; the database and all media are under that directory.

## Docker Compose

Set `SESSION_SECRET` in `.env`, then:

```sh
docker compose up --build -d
```

Compose runs one app container and mounts a named data volume. For direct use:

```sh
docker build -t chuckflix .
docker run -p 10000:10000 --env-file .env -v chuckflix_data:/app/data chuckflix
```

## Render Free

1. Push the repository to GitHub.
2. Create a Render Blueprint from `render.yaml`, or create one Docker Web Service using `Dockerfile`.
3. Keep the generated `SESSION_SECRET`; set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as secret environment values if the app should bootstrap an administrator on first startup. Use a password at least 12 characters long.
4. Deploy and verify `/healthz` returns `{"status":"ok"}`.

No database, cache, storage, bot, or worker service is required. Render's Free container filesystem is ephemeral; the SQLite database and media can disappear when Render replaces the instance. The Blueprint intentionally does not create a paid persistent disk.

## Demo Content

Set `SEED_DEMO=true` to generate a few original synthetic clips after the app starts, but only when the library is empty. Or run `npm run seed`; it waits for real FFmpeg processing and reports ready/failed counts. The command does not overwrite an existing library.

## Health and Shutdown

- `GET /healthz`: public process health check
- `GET /health/ready`: SQLite readiness
- `SIGTERM` and `SIGINT`: stop the HTTP server, clean the session expiry timer, and close SQLite