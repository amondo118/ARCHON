# ARCHON architecture (as built, v0.1)

```
Browser (vanilla JS ES modules, Cytoscape.js)
  views ─ components ─ canvas ─ core/store ─ api/client
                         │ HTTP/JSON  /api/v1
Express
  routes (HTTP only) → services (rules, validation, transactions) → repositories (all SQL)
                         │
SQLite (better-sqlite3, WAL, foreign keys ON)
```

## Backend: `server/`

| Path | Responsibility |
|---|---|
| `server.js` | Entry point: open DB, start HTTP, graceful shutdown |
| `app.js` | `createApp(db, config)`: middleware, routes, static files, vendor libs from `node_modules` |
| `config/config.js` | Environment configuration |
| `database/database.js` | Open DB, pragmas, migration runner (`migrations/NNN_name.sql`, applied in order, recorded in `schema_migrations`) |
| `domain/types.js` | **Single source** for enums and structural rules (object types, parent/child rules, relationship type rules). Served to the UI via `GET /meta`. |
| `repositories/` | `tableRepo.js` (generic per-table CRUD) + `index.js` (entity-specific queries). The only place with SQL. |
| `services/` | One per entity. Business rules, validation (`utils/validate.js`), ownership checks, transactions. `transfer.service.js` = import/export. |
| `routes/` | Thin Express routers: map HTTP to service calls, wrap results in the response envelope |
| `middleware/errors.js` | Error → envelope mapping (internal errors are logged, never leaked), security headers |

**Rules enforced in services** (all covered by `test/`):
- Project ownership always comes from the database, never from the client.
- Parent/child types: members (`method`, `property`, `signal`, `event`) must be inside a container type, and nothing can be placed inside itself or one of its own descendants.
- Children always share their parent's module. A module change on a parent cascades to its children.
- Relationships: same project, no self-links, unique `(source, target, type)`, `inherits` single-parent and acyclic, `implements` → interface.
- Deleting an object deletes its children and their relationships (FK cascade) and unlinks tasks and notes (`SET NULL`). `GET /objects/:id/delete-impact` previews this.
- Deleting a module never deletes objects: sub-modules move up a level, and objects become unassigned.

## Database

See `server/database/migrations/001_initial.sql` (that file is the schema).

| Table | Notes |
|---|---|
| `projects` | |
| `modules` | `parent_module_id` for nesting |
| `architecture_objects` | One table for all types. `parent_id` = containment. `metadata` = JSON. |
| `relationships` | Directed, typed. `UNIQUE(source_id, target_id, type)` |
| `tasks`, `notes` | Optional `linked_object_id` |
| `canvas_layouts` | One per project in v0.1 (auto-created) |
| `canvas_positions` | PK `(canvas_id, object_id)`. A row for a *child* object = **promoted** (shown as its own node). `collapsed` = card folded. Presentation only. |

Enumerations are validated in code, not with SQL `CHECK`, so new types need no migration.

## API (`/api/v1`)

All responses are `{ success, data, error }`, including deletes (`200`, `data: null`). The one exception is `GET /projects/:id/export`, which returns the raw interchange document so the download can be imported as-is.

```
GET  /health  /meta
GET|POST          /projects            GET|PATCH|DELETE /projects/:id
GET               /projects/:id/stats  /projects/:id/graph   (graph = everything the canvas needs)
GET|POST          /projects/:id/{modules|objects|relationships|tasks|notes}
GET|PATCH|DELETE  /{modules|relationships|tasks|notes}/:id
GET|PATCH|DELETE  /objects/:id          (GET returns details: children, in/out relationships, tasks, notes)
GET               /objects/:id/delete-impact
GET               /projects/:id/canvases
PUT               /canvases/:id/positions   { positions: [{object_id,x,y,collapsed}], remove: [object_id] }
GET               /projects/:id/export
POST              /projects/import
POST              /backup                   (downloads a consistent .db snapshot)
```

## Frontend: `public/js/`

| Path | Responsibility |
|---|---|
| `app.js` | Boot, hash router (`#/<projectId>/<view>`), shell, panel toggles |
| `api/client.js` | The only module that calls `fetch` |
| `core/store.js` | Cache of the current project. Every mutation goes through the API first, then updates the cache and emits events. |
| `core/saver.js` | Tracks in-flight and debounced writes for the Saving… / Saved / Save failed indicator, and flushes them before navigation |
| `core/dom.js` | `h()` element builder and small helpers |
| `canvas/elements.js` | **Pure** data → Cytoscape elements (hybrid cards, promotion, edge rerouting/merging, auto placement) |
| `canvas/canvas.js` | Cytoscape controller: sync, drag-as-a-card, connect mode, search highlight, auto layout |
| `canvas/style.js` | Cytoscape stylesheet built from the CSS variables |
| `components/` | Modal, toast, object picker, sidebar, object/relationship dialogs, importer (drop zone) |
| `views/` | Overview, architecture, inspector, tasks, notes, settings. Each `mountX(container)` returns an unmount function. |

**Canvas model.** A top-level object (or a promoted child) is a *root*. An expanded root with children becomes a Cytoscape compound node: a header row plus one row per child, stacked under the stored anchor position. Child positions are computed, never stored. A relationship to a hidden object is drawn to its nearest visible ancestor, and parallel edges are merged (`calls ×3`).

Browser libraries (`cytoscape`, `marked`, `dompurify`, `lucide-static`) are served from `node_modules` under `/vendor/…`: pinned by the lockfile, no CDN.
