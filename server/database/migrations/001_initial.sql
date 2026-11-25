-- ARCHON initial schema.
-- Enumerated values (object types, statuses, ...) are validated in
-- server/domain/types.js, not with CHECK constraints, so new values never
-- require a schema change.

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE modules (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  color            TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_modules_project ON modules(project_id);
CREATE INDEX idx_modules_parent  ON modules(parent_module_id);

CREATE TABLE architecture_objects (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id             TEXT REFERENCES modules(id) ON DELETE SET NULL,
  parent_id             TEXT REFERENCES architecture_objects(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  health_status         TEXT NOT NULL DEFAULT 'unreviewed',
  implementation_status TEXT NOT NULL DEFAULT 'planned',
  visibility            TEXT NOT NULL DEFAULT 'none',
  file_path             TEXT,
  metadata              TEXT NOT NULL DEFAULT '{}',
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_objects_project ON architecture_objects(project_id);
CREATE INDEX idx_objects_parent  ON architecture_objects(parent_id);
CREATE INDEX idx_objects_module  ON architecture_objects(module_id);

CREATE TABLE relationships (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES architecture_objects(id) ON DELETE CASCADE,
  target_id     TEXT NOT NULL REFERENCES architecture_objects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'unreviewed',
  description   TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (source_id, target_id, type)
);
CREATE INDEX idx_rel_project ON relationships(project_id);
CREATE INDEX idx_rel_source  ON relationships(source_id);
CREATE INDEX idx_rel_target  ON relationships(target_id);

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id        TEXT REFERENCES modules(id) ON DELETE SET NULL,
  linked_object_id TEXT REFERENCES architecture_objects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'backlog',
  priority         TEXT NOT NULL DEFAULT 'medium',
  due_date         TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_object  ON tasks(linked_object_id);

CREATE TABLE notes (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_object_id TEXT REFERENCES architecture_objects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL DEFAULT 'general',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_notes_project ON notes(project_id);
CREATE INDEX idx_notes_object  ON notes(linked_object_id);

CREATE TABLE canvas_layouts (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_canvases_project ON canvas_layouts(project_id);

-- A row for a member object (method, property, ...) means it is "promoted"
-- to an independent canvas node. Presentation only; never changes parent_id.
CREATE TABLE canvas_positions (
  canvas_id TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL REFERENCES architecture_objects(id) ON DELETE CASCADE,
  x         REAL NOT NULL,
  y         REAL NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canvas_id, object_id)
);
CREATE INDEX idx_positions_object ON canvas_positions(object_id);
