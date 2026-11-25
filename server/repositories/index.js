import { tableRepo } from './tableRepo.js';

const TS = ['created_at', 'updated_at'];

/** Creates every repository for a database connection. All SQL lives here. */
export function createRepositories(db) {
  const projects = tableRepo(db, 'projects', {
    columns: ['id', 'name', 'description', ...TS],
  });
  projects.list = () => db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all();
  projects.stats = (projectId) => ({
    modules: db.prepare('SELECT COUNT(*) FROM modules WHERE project_id = ?').pluck().get(projectId),
    objects: db.prepare('SELECT COUNT(*) FROM architecture_objects WHERE project_id = ?').pluck().get(projectId),
    relationships: db.prepare('SELECT COUNT(*) FROM relationships WHERE project_id = ?').pluck().get(projectId),
    health: db.prepare(`SELECT health_status AS status, COUNT(*) AS count FROM architecture_objects
                        WHERE project_id = ? GROUP BY health_status`).all(projectId),
    tasks: db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE project_id = ? GROUP BY status').all(projectId),
    attention: db.prepare(`SELECT id, name, type, health_status FROM architecture_objects
                           WHERE project_id = ? AND health_status IN ('warning','bad')
                           ORDER BY health_status = 'bad' DESC, name LIMIT 50`).all(projectId),
    recent: db.prepare(`SELECT id, name, type, updated_at FROM architecture_objects
                        WHERE project_id = ? ORDER BY updated_at DESC LIMIT 10`).all(projectId),
  });

  const modules = tableRepo(db, 'modules', {
    columns: ['id', 'project_id', 'parent_module_id', 'name', 'description', 'color', 'sort_order', ...TS],
    orderBy: 'sort_order, name COLLATE NOCASE, rowid',
  });
  modules.reparentChildren = (moduleId, newParentId) =>
    db.prepare('UPDATE modules SET parent_module_id = ? WHERE parent_module_id = ?').run(newParentId, moduleId);

  const objects = tableRepo(db, 'architecture_objects', {
    columns: ['id', 'project_id', 'module_id', 'parent_id', 'type', 'name', 'description', 'health_status',
      'implementation_status', 'visibility', 'file_path', 'metadata', 'sort_order', ...TS],
    json: ['metadata'],
    orderBy: 'sort_order, name COLLATE NOCASE',
  });
  objects.children = (parentId) =>
    db.prepare('SELECT * FROM architecture_objects WHERE parent_id = ? ORDER BY sort_order, rowid').all(parentId);
  objects.maxChildOrder = (parentId) =>
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) FROM architecture_objects WHERE parent_id IS ?').pluck().get(parentId);
  /** All descendant ids (not including the root). */
  objects.descendantIds = (id) => db.prepare(`
      WITH RECURSIVE d(id) AS (
        SELECT id FROM architecture_objects WHERE parent_id = ?
        UNION ALL SELECT o.id FROM architecture_objects o JOIN d ON o.parent_id = d.id)
      SELECT id FROM d`).pluck().all(id);
  objects.setModuleForDescendants = (id, moduleId) => db.prepare(`
      WITH RECURSIVE d(id) AS (
        SELECT id FROM architecture_objects WHERE parent_id = ?
        UNION ALL SELECT o.id FROM architecture_objects o JOIN d ON o.parent_id = d.id)
      UPDATE architecture_objects SET module_id = ? WHERE id IN (SELECT id FROM d)`).run(id, moduleId);

  const relationships = tableRepo(db, 'relationships', {
    columns: ['id', 'project_id', 'source_id', 'target_id', 'type', 'health_status', 'description', 'metadata', ...TS],
    json: ['metadata'],
  });
  relationships.find = (sourceId, targetId, type) =>
    db.prepare('SELECT id FROM relationships WHERE source_id = ? AND target_id = ? AND type = ?').get(sourceId, targetId, type);
  relationships.inheritsFrom = (sourceId) =>
    db.prepare("SELECT * FROM relationships WHERE source_id = ? AND type = 'inherits'").get(sourceId);
  relationships.countTouching = (ids) => {
    if (!ids.length) return 0;
    const marks = ids.map(() => '?').join(',');
    return db.prepare(`SELECT COUNT(*) FROM relationships WHERE source_id IN (${marks}) OR target_id IN (${marks})`)
      .pluck().get(...ids, ...ids);
  };
  relationships.forObject = (id) => ({
    outgoing: db.prepare('SELECT * FROM relationships WHERE source_id = ?').all(id),
    incoming: db.prepare('SELECT * FROM relationships WHERE target_id = ?').all(id),
  });

  const tasks = tableRepo(db, 'tasks', {
    columns: ['id', 'project_id', 'module_id', 'linked_object_id', 'title', 'description', 'status', 'priority',
      'due_date', 'sort_order', ...TS],
    orderBy: 'sort_order, created_at, rowid',
  });
  const notes = tableRepo(db, 'notes', {
    columns: ['id', 'project_id', 'linked_object_id', 'title', 'content', 'type', ...TS],
    orderBy: 'created_at, rowid', // stable for export; the UI sorts by updated_at
  });
  const countLinked = (table) => (ids) => {
    if (!ids.length) return 0;
    return db.prepare(`SELECT COUNT(*) FROM ${table} WHERE linked_object_id IN (${ids.map(() => '?').join(',')})`)
      .pluck().get(...ids);
  };
  tasks.countLinked = countLinked('tasks');
  notes.countLinked = countLinked('notes');

  const canvases = tableRepo(db, 'canvas_layouts', {
    columns: ['id', 'project_id', 'name', 'config', ...TS],
    json: ['config'],
  });

  const positions = {
    list: (canvasId) => db.prepare('SELECT object_id, x, y, collapsed FROM canvas_positions WHERE canvas_id = ?')
      .all(canvasId).map((p) => ({ ...p, collapsed: Boolean(p.collapsed) })),
    upsert: db.prepare(`INSERT INTO canvas_positions (canvas_id, object_id, x, y, collapsed)
                        VALUES (@canvas_id, @object_id, @x, @y, @collapsed)
                        ON CONFLICT (canvas_id, object_id)
                        DO UPDATE SET x = excluded.x, y = excluded.y, collapsed = excluded.collapsed`),
    remove: db.prepare('DELETE FROM canvas_positions WHERE canvas_id = ? AND object_id = ?'),
  };

  return { db, projects, modules, objects, relationships, tasks, notes, canvases, positions };
}
