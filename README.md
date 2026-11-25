# ARCHON

A lightweight, self-hosted visual organizer for software architecture. You document classes, methods, signals and their relationships by hand, see them on a canvas, and track tasks and design decisions alongside them.

- **Hybrid canvas:** classes are cards that list their members. Any member can be pulled out as its own node, and methods can be connected directly to each other.
- **Inspector:** edit everything, explore incoming and outgoing relationships and the inheritance chain, and see linked tasks and notes.
- **Tasks:** a simple Kanban board. **Documentation:** Markdown notes and decision records.
- **Drop-in JSON import:** drop a `.json` file onto the window to import a project. The format is designed to be generated from a codebase (see [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md)).
- **Single source of truth:** SQLite. One Docker service, no external dependencies at runtime.

Stack: Node 22, Express, SQLite (better-sqlite3), vanilla JS ES modules, Cytoscape.js. No build step.

## Run locally

```bash
npm ci
```

```bash
npm start
```

Open http://localhost:3000, then drop `examples/medieval-empire.archon.json` onto the page to load a sample project.

| Command | |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file changes |
| `npm test` | API and business-rule tests (`node:test`, in-memory DB) |

Configuration (environment variables, see `.env.example`):

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_PATH` | `./data/archon.db` | SQLite file (created on first start) |
| `BACKUP_DIR` | `<db dir>/backups` | Where backup snapshots are written |
| `IMPORT_LIMIT` | `10mb` | Max JSON request size |

## Deploy with Docker

The container runs as uid 1000, so the data directory must be writable by that user:

```bash
mkdir -p data && sudo chown 1000:1000 data
```

```bash
docker compose up -d --build
```

The compose file only `expose`s port 3000, for use behind a reverse proxy. To reach it directly, or to join your proxy's Docker network, copy `docker-compose.override.yml.example` to `docker-compose.override.yml` and edit it. If Docker Hub rate-limits you, build from a mirror:

```bash
docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
```

The container has a read-only root filesystem, drops all capabilities, and has a health check at `/api/v1/health`.

> **Security:** ARCHON v0.1 has no authentication. Only run it on a trusted private network or VPN, or behind reverse-proxy authentication (basic auth, forward auth), until app-level auth exists.

## Backup and restore

- **Whole database:** *Settings → Download backup* (or `POST /api/v1/backup`) creates a consistent SQLite snapshot. It is safe while the app is running, and a copy is kept in `BACKUP_DIR`.
- **One project:** *Settings → Export JSON* (or `GET /api/v1/projects/:id/export`) gives a portable file that can be imported on any ARCHON installation.

**Restore a database snapshot:**

```bash
docker compose stop archon
```

```bash
cp archon-<timestamp>.db data/archon.db && rm -f data/archon.db-wal data/archon.db-shm && sudo chown 1000:1000 data/archon.db
```

```bash
docker compose start archon
```

**Restore a project:** drop its `.archon.json` file onto ARCHON. The import creates a new project, so it never overwrites an existing one.

## Documentation

- [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md): JSON import/export format, and how to generate a file from a codebase
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized, database schema, API
- [docs/SPEC_REVIEW.md](docs/SPEC_REVIEW.md): the scope decisions behind v0.1
- [TASKS.md](TASKS.md): implementation status and what is deferred
