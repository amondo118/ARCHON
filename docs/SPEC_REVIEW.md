# ARCHON v0.1 spec review: suggested changes

Goal: a working first build. This review keeps the spec's intent, cuts what doesn't serve that goal, and fixes the places where the spec is ambiguous or contradicts itself. Each item says **what** to change and **why**.

The spec is good. It makes the right core calls: manual-first, SQLite as the only source of truth, positions stored apart from architecture data, no build step, no framework. Most of the trouble is **scope creep inside the MVP** and **one major technical risk (the hybrid canvas) that isn't scheduled until M4**.

---

## 1. Top 5 changes (if you only read this)

1. **Prototype the hybrid canvas early.** It's the core feature and the biggest unknown. Pick the approach (compound nodes, §4.1) before building any UI around it.
2. **Cut 11 milestones down to 6** (§6). Most current milestones are a single view, and an approval stop after every one is a lot of overhead for a tool this size.
3. **One canvas per project in v0.1.** Keep the `canvas_layouts` table but create a single default canvas automatically. Defer multiple layouts, structured mode, grouping, grid snapping and undo/redo.
4. **Remove the `contains` relationship type.** `parent_id` already means containment. Having both creates two sources of truth.
5. **Pin down the three undefined state rules:** where "promoted" and "collapsed" are stored (§3.4), what happens to edges when a parent is collapsed (§4.2), and when autosave flushes (§5.3).

---

## 2. Scope: cut, defer, or simplify

| Spec item | Suggestion | Reason |
|---|---|---|
| Undo/redo (§8.2) | **Defer** | A command/history model touches every mutation. Confirm dialogs on delete cover the real risk. |
| Structured canvas mode (§5.4) | **Defer** | The spec already defers it. Add one "Auto layout" button (Cytoscape's built-in `breadthfirst`/`cose`, no extension) and stop there. |
| Multiple canvas layouts per project | **Defer the UI, keep the table** | Auto-create one canvas per project. The schema stays ready for more later. |
| Grouping, grid snapping, multi-select, context menu | **Defer** | Cytoscape gives box-select almost free, so allow it if it costs nothing, but don't build features on top of it. |
| Dependency explorer as a separate view (M7) | **Fold into the inspector** | An "Incoming / Outgoing / Inherits from / Inherited by" section in the inspector, plus a type filter and click-to-navigate, meets the M7 acceptance criteria. Build a dedicated graph view later. |
| Dashboard (§5.3) | **Minimal** | Counts, health distribution, task progress, and a list of warning/bad objects. One SQL query each. Skip "recent modifications" or make it `ORDER BY updated_at LIMIT 10`. |
| Pagination / filtering on APIs | **Drop** | At 500 objects and 1,500 relationships, return everything per project and filter on the client. |
| Tablet support | **Drop for v0.1** | Desktop only. |
| Documentation view + Markdown | **Keep, but late and small** | Needs `marked` and `DOMPurify`, both vendored. Fine in the last feature milestone. |
| Settings view | **Drop or stub** | Nothing in v0.1 needs settings. Put backup and export on the project page. |
| Health status on relationships | **Keep the column, no UI** | It's cheap in the schema, but nobody needs it in the first build. |
| `metadata` JSON on objects and relationships | **Keep the column, no UI** | Useful for later. Leave it empty in v0.1. Validate that it's an object if sent. |
| 5 doc files + TASKS.md | **Consolidate** | `README.md` (setup, run, deploy, backup/restore), `docs/SPEC.md`, `docs/ARCHITECTURE.md` (include the DB schema summary; the migration SQL is the actual schema). Keep `TASKS.md`. Fewer files means docs actually stay current. |

---

## 3. Data model: corrections

### 3.1 Remove `contains` as a relationship type
`parent_id` is the containment structure. A `contains` edge would duplicate it and could disagree with it. If you want to show containment visually, derive it from `parent_id`.

### 3.2 Make parent/child rules concrete
"Appropriate parent" isn't implementable as written. Suggested rule table, kept as one JS constant in `server/domain/objectTypes.js`:

```js
// Types that can hold members
CONTAINER = ['class','interface','script','component','manager','struct','enum','resource']
// Types that must live inside a container
MEMBER    = ['method','property','signal','event']
// Types that can be top-level or nested in a container
FREE      = ['function','other']   // + every CONTAINER type (allows nested classes)
```

- A `MEMBER` **must** have a parent, and that parent must be a `CONTAINER`.
- A `CONTAINER` or `FREE` object may have no parent, or a `CONTAINER` parent.
- Nothing may be parented to a `MEMBER`.
- Reject `parent_id` cycles. This only matters for nested containers.
- **Children inherit the parent's `module_id` and `project_id`.** Ignore or reject a different `module_id` on a child, otherwise a method can end up in a different module from its class.
- Validate types in JS, with **no SQL `CHECK` constraint**. This satisfies "new types without a schema change".

### 3.3 Relationship rules (add what's missing)
- `UNIQUE(source_id, target_id, type)` handles duplicate prevention at the database level.
- Disallow `source_id = target_id`.
- `inherits` only between compatible types (class→class, interface→interface, struct→struct). Allow at most one `inherits` per source and reject cycles. Only `inherits` needs a cycle check.
- `implements`: source is class/struct/component, target is interface.
- Every other type is allowed between any two objects in the same project.

### 3.4 Canvas positions: simplify and define "promoted" and "collapsed"
The spec never says where promotion state or expand/collapse state lives. Suggestion:

```sql
canvas_positions (
  canvas_id   TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE,
  object_id   TEXT NOT NULL REFERENCES architecture_objects(id) ON DELETE CASCADE,
  x REAL NOT NULL, y REAL NOT NULL,
  collapsed   INTEGER NOT NULL DEFAULT 0,  -- for containers
  PRIMARY KEY (canvas_id, object_id)
)
```

- **Drop** the surrogate `id`. The composite key is the identity.
- **Drop** `width`/`height`. Cytoscape sizes nodes from their content.
- **Promoted** = a *member* object that has its own row in `canvas_positions`. Un-promoting deletes the row. This is presentation-only, as the spec requires.
- Top-level objects with no row get placed automatically (a simple grid) and saved on first drag.
- Drop `canvas_layouts.type` and `module_id` for v0.1, or keep them as unused columns. Don't build UI for them.

### 3.5 Deletion semantics (make "safe deletion" concrete)
- `architecture_objects.parent_id` → `ON DELETE CASCADE` (children go with the parent).
- `relationships.source_id/target_id` → `ON DELETE CASCADE`.
- `tasks.linked_object_id`, `notes.linked_object_id` → `ON DELETE SET NULL` (tasks and notes are kept).
- `modules.parent_module_id` → `RESTRICT`, and `architecture_objects.module_id` → `SET NULL`. Deleting a module never deletes architecture.
- Add a `GET /objects/:id/delete-impact` endpoint that returns `{ children: n, relationships: n, tasks: n, notes: n }`. The confirm dialog shows these counts. This is what satisfies "explain what will be affected" without building a reassignment workflow.
- Deleting a project cascades everything, behind a type-the-project-name confirmation.

### 3.6 Small items
- IDs: `crypto.randomUUID()` (built in, no dependency).
- Timestamps: ISO-8601 UTC strings, set in the repository layer, not with SQL defaults spread across tables.
- `sort_order`: keep on `tasks` (column ordering) and on children (method order inside a class). Drop it on top-level objects and modules.
- Indexes: `project_id` on every table, `parent_id`, `source_id`, `target_id`, `linked_object_id`.
- `PRAGMA foreign_keys = ON` **on every connection** (SQLite defaults it to off), plus `journal_mode = WAL` and `busy_timeout`.

---

## 4. Canvas / hybrid representation: the biggest risk

The spec describes HTML-like cards ("METHODS 3 / move_to_target() …") but Cytoscape draws nodes on a `<canvas>`, so arbitrary HTML can't go inside nodes. This needs a concrete decision up front.

### 4.1 Recommended approach: compound nodes
- **Expanded class** = a Cytoscape *compound* parent node, labelled at the top with name + status. Its methods, properties and signals are **real child nodes**, stacked in a column. Child positions are **computed** from the parent's position and `sort_order`, not stored. Children are `grabbable: false`, so dragging the class moves the whole card.
- Result: individual methods are clickable, selectable and **connectable to other methods directly**. That covers "connect individual methods" with no extra work.
- **Collapsed class** = an ordinary node with a two-line label (`Villager · GOOD\n3 methods`). Children are removed from the graph.
- **Promoted method** = a top-level node with its own stored position. It is also hidden from its parent's compound list while promoted. Its `parent_id` doesn't change.
- Status is shown by border color **and** a text tag in the label (the color-alone accessibility rule).

Fallback if compound nodes feel wrong: plain nodes with multi-line text labels for the method list, with methods clickable only through the inspector. It's less capable but trivially simple. **Avoid** HTML-overlay extensions (`node-html-label` etc.). They are the usual source of zoom/pan sync bugs and performance problems.

### 4.2 Edge rule when endpoints are hidden (spec doesn't say)
If a relationship's endpoint isn't visible (a collapsed member that isn't promoted), draw the edge to its **nearest visible ancestor**. Merge duplicates and show a count ("3 calls"). This is computed on the client only and never stored.

### 4.3 Saving positions
Save on `dragfree` (drag end), not during the drag. Debounce about 500 ms and batch into `PUT /canvases/:id/positions` with only the changed rows.

---

## 5. API: corrections

### 5.1 Add one aggregate read for the canvas
`GET /projects/:id/graph` → `{ objects, relationships, canvas, positions }` in a single response. Otherwise opening the architecture view takes four requests plus client-side joining. This is the "meaningful resource operation" the spec asks for.

### 5.2 Other endpoint changes
| Change | Reason |
|---|---|
| Add `GET /objects/:id/delete-impact` | §3.5 |
| Add `POST /backup` → downloads a consistent `.db` snapshot | better-sqlite3's `db.backup()` handles WAL correctly. Writing it to `/data/backups/` is also fine. |
| Add `GET /health` (already in compose, missing from the table) | |
| Drop `POST/PATCH /canvases` for v0.1 | Single auto-created canvas (§2). |
| Return `200` with `{success:true,data:null}` on DELETE instead of `204` | A 204 has no body, which breaks the "every response uses the envelope" rule. Pick one rule. |
| Import **always creates a new project with remapped IDs** | This settles "don't overwrite silently" for good, and lets you import the same file twice (e.g. to duplicate a project). Include `format_version` in the export. |

### 5.3 Security items that don't apply as written
- **CORS:** the frontend is served by the same Express app, so don't install `cors` at all. Same-origin is the default. Remove the line.
- **"Protect destructive API operations":** without auth this means nothing. Replace it with *"deployment must be LAN/VPN-only or behind reverse-proxy auth (e.g. basic auth / forward-auth) until app auth exists."*
- Add `express.json({ limit: '10mb' })` so imports have a size cap.
- **Validation:** hand-written validators per entity (a small `utils/validate.js` helper). No zod/joi needed at this size.

---

## 6. Revised milestones (11 → 6)

The spec says "start with the data model and a basic canvas" (§14) but schedules the canvas fourth. This plan follows §14.

| # | Milestone | Contents | Acceptance |
|---|---|---|---|
| **M0** | Foundation | Express, SQLite + migration runner, `/health`, static shell (sidebar / workspace / inspector panels, CSS variables), Dockerfile + compose, `node --test` wired up | `npm start` and `docker compose up` both serve the shell, and the health check passes |
| **M1** | Data layer + API | Full schema migration. Repositories/services/routes for projects, modules, objects, relationships, canvas positions, plus `/graph`. **All §3 validation rules, with tests.** No UI beyond what M0 had. | The test suite covers ownership, parent rules, inheritance cycles, duplicates and cascades. Data survives a restart. |
| **M2** | Canvas *(do the compound-node prototype on day one)* | Project switcher, module sidebar, Cytoscape canvas, add-object form, drag + save positions, expand/collapse, promote/un-promote, edge creation by drag (`cytoscape-edgehandles`), auto-layout button, zoom/fit | The Medieval Empire prototype from §14 can be built entirely in the UI and survives a reload |
| **M3** | Inspector | Edit all fields, children list (add/reorder/delete methods), relationships in/out with filters and click-to-navigate (*this replaces M7*), add relationship by search, delete with impact preview, save indicator | Any object can be fully documented and its dependencies investigated without the canvas |
| **M4** | Tasks + Notes + Dashboard | Kanban with native HTML5 drag-and-drop, link to object, filter by status/priority; notes with sanitized Markdown; minimal dashboard | Tasks and notes persist and appear in the linked object's inspector |
| **M5** | Portability + deploy | Export/import (with tests), DB backup endpoint, restore instructions, production Docker hardening, README | Export → import on a fresh container reproduces the project, and the container restarts cleanly with data intact |

**After v0.1:** undo/redo, structured mode, multiple canvases, grouping, a dedicated dependency graph view, search across notes, auth.

Approval stops: after M0, M1 and M2 (the risky ones). M3–M5 can run straight through.

---

## 7. Stack and deployment details that will bite

1. **Serve frontend libraries locally, no CDN.** It's a private-network tool. Mount `node_modules/cytoscape/dist` (and edgehandles, marked, dompurify) with `express.static` under `/vendor/`. Versions stay pinned through the lockfile and nothing needs copying.
2. **Lucide without a build step:** copy the ~25 SVGs you use into `public/assets/icons/`, or use `lucide-static`'s sprite. Don't load the runtime JS library.
3. **Fonts:** vendor Inter and JetBrains Mono woff2 into `public/assets/fonts/`, or just use system UI and monospace stacks for v0.1.
4. **better-sqlite3 is a native module.** Use `node:22-bookworm-slim` (glibc, prebuilt binaries available), **not Alpine**, or the image build will need python/make/g++. Pin the Node major version in `package.json` `engines` and in the Dockerfile.
5. **Volume permissions:** the container runs as the non-root `node` user (uid 1000). A host `./data` owned by root makes SQLite fail with a confusing error. Document `mkdir -p data && chown 1000:1000 data`, or have the entrypoint check that `/data` is writable and fail with a clear message.
6. **Compose has only `expose:`**, which is right for the reverse proxy but means nothing is reachable for local testing. Add a `docker-compose.override.yml.example` with `ports: ["3000:3000"]`, plus an `external: true` network stanza with a placeholder name.
7. **Tests:** the built-in `node:test` against a `:memory:` (or temp-file) database, plus `fetch` against the app on an ephemeral port. No jest or supertest needed.
8. **Frontend drag-and-drop for Kanban:** native HTML5 DnD. No library.

**Final dependency list:** `express`, `better-sqlite3`, `cytoscape`, `cytoscape-edgehandles`, `marked`, `dompurify`. That's six, each with a clear purpose.

---

## 8. Ambiguities to resolve in the spec text

| Spec says | Make it say |
|---|---|
| "Switching projects must not lose unsaved changes" + "safe autosaving" | Inspector fields save on blur / Enter (debounced), and every pending save is flushed before navigation. The global indicator shows Saving… / Saved / Save failed (with retry). |
| "Expand to canvas" / promoted children stay visible when parent collapsed | See §4.1: promoted = own position row, independent of the parent's collapsed flag. |
| "Modules accessible from the sidebar" | The sidebar shows a module tree. Clicking a module **filters** the canvas to that module's objects. Modules are not drawn as canvas groups in v0.1 (objects are tinted with the module color). |
| Toolbar "Search" / "Filter" | Client-side: search by name highlights and centers the match, and the filter toggles object types and relationship types. |
| Relationship `signal` vs object types `signal`/`event` | A `signal` relationship goes from a `signal`/`event` object to the handler it connects to. Note this; don't enforce it. |
| §13 "Create `docs/PROJECT_SPEC.md` with the complete specification above" | Strip §13–14 (the meta/advice sections) out of the stored spec. They are instructions *about* the spec, not part of it, and they'll confuse later sessions. |

---

## 9. What I'd leave exactly as written

- Non-goals list (§1.3). It's good, keep it strict.
- Three-layer backend (routes → services → repositories). It's the right amount of structure.
- Response envelope and error codes (with the DELETE fix).
- Color palette as CSS variables.
- "Positions never change architecture" and "SQLite is the source of truth". These are the two most important rules in the document.
- Using ARCHON to document ARCHON once M3 is done. It's the best test the app will get.
