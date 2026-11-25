import { AppError, badRequest } from '../utils/errors.js';

/**
 * ARCHON interchange format (see docs/IMPORT_FORMAT.md).
 *
 * Objects reference each other by human-readable keys instead of database ids,
 * so a file can be written by hand or generated from a codebase. Import always
 * creates a NEW project with fresh ids, so nothing is ever overwritten.
 */
export const FORMAT = 'archon';
export const FORMAT_VERSION = 1;
const MAX_ERRORS = 50;
const MAX_OBJECTS = 20000;

const stripCall = (key) => key.replace(/\(\)$/, '');

export function transferService(repos, services) {
  // ---------------------------------------------------------------- export
  function exportProject(projectId) {
    const project = services.projects.get(projectId);
    const modules = repos.modules.listByProject(projectId);
    const objects = repos.objects.listByProject(projectId);
    const canvas = services.projects.defaultCanvas(projectId);

    const uniq = (used, base) => {
      let key = base;
      for (let i = 2; used.has(key); i++) key = `${base}#${i}`;
      used.add(key);
      return key;
    };

    const moduleKeys = new Map();
    const usedModuleKeys = new Set();
    for (const m of modules) moduleKeys.set(m.id, uniq(usedModuleKeys, m.name));

    const childrenOf = new Map();
    for (const o of objects) {
      const list = childrenOf.get(o.parent_id ?? null) ?? [];
      list.push(o);
      childrenOf.set(o.parent_id ?? null, list);
    }
    const objectKeys = new Map();
    const usedObjectKeys = new Set();
    const build = (o, parentKey) => {
      const key = uniq(usedObjectKeys, parentKey ? `${parentKey}.${o.name}` : o.name);
      objectKeys.set(o.id, key);
      const out = {
        key,
        type: o.type,
        name: o.name,
        ...(o.module_id && !o.parent_id ? { module: moduleKeys.get(o.module_id) } : {}),
        ...(o.description ? { description: o.description } : {}),
        health_status: o.health_status,
        implementation_status: o.implementation_status,
        ...(o.visibility !== 'none' ? { visibility: o.visibility } : {}),
        ...(o.file_path ? { file_path: o.file_path } : {}),
        ...(Object.keys(o.metadata).length ? { metadata: o.metadata } : {}),
      };
      const kids = (childrenOf.get(o.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      if (kids.length) out.children = kids.map((k) => build(k, key));
      return out;
    };
    const tree = (childrenOf.get(null) ?? []).map((o) => build(o, null));

    return {
      format: FORMAT,
      format_version: FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      project: { name: project.name, description: project.description },
      modules: modules.map((m) => ({
        key: moduleKeys.get(m.id),
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
        ...(m.color ? { color: m.color } : {}),
        ...(m.parent_module_id ? { parent: moduleKeys.get(m.parent_module_id) } : {}),
      })),
      objects: tree,
      relationships: repos.relationships.listByProject(projectId).map((r) => ({
        source: objectKeys.get(r.source_id),
        target: objectKeys.get(r.target_id),
        type: r.type,
        ...(r.description ? { description: r.description } : {}),
        ...(r.health_status !== 'unreviewed' ? { health_status: r.health_status } : {}),
      })),
      tasks: repos.tasks.listByProject(projectId).map((t) => ({
        title: t.title,
        ...(t.description ? { description: t.description } : {}),
        status: t.status,
        priority: t.priority,
        ...(t.due_date ? { due_date: t.due_date } : {}),
        ...(t.module_id ? { module: moduleKeys.get(t.module_id) } : {}),
        ...(t.linked_object_id ? { object: objectKeys.get(t.linked_object_id) } : {}),
      })),
      notes: repos.notes.listByProject(projectId).map((n) => ({
        title: n.title,
        type: n.type,
        content: n.content,
        ...(n.linked_object_id ? { object: objectKeys.get(n.linked_object_id) } : {}),
      })),
      canvas: {
        positions: repos.positions.list(canvas.id).map((p) => ({
          object: objectKeys.get(p.object_id), x: Math.round(p.x), y: Math.round(p.y),
          ...(p.collapsed ? { collapsed: true } : {}),
        })).sort((a, b) => a.object.localeCompare(b.object)),
      },
    };
  }

  // ---------------------------------------------------------------- import
  /** Pass 1: structure, keys and references. Collects all errors instead of stopping at the first. */
  function analyse(doc) {
    const errors = [];
    const err = (path, msg) => { if (errors.length < MAX_ERRORS) errors.push({ path, message: msg }); };
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const arr = (v, path) => {
      if (v === undefined) return [];
      if (!Array.isArray(v)) { err(path, 'must be an array'); return []; }
      return v;
    };

    if (!isObj(doc)) return { errors: [{ path: '$', message: 'File must contain a JSON object.' }] };
    if (doc.format !== undefined && doc.format !== FORMAT) err('format', `must be "${FORMAT}"`);
    if (doc.format_version !== undefined && doc.format_version !== FORMAT_VERSION) {
      err('format_version', `unsupported version ${doc.format_version} (this server reads version ${FORMAT_VERSION})`);
    }
    if (!isObj(doc.project) || typeof doc.project.name !== 'string' || !doc.project.name.trim()) {
      err('project.name', 'is required');
    }

    const modules = new Map(); // key -> {item, path}
    arr(doc.modules, 'modules').forEach((m, i) => {
      const path = `modules[${i}]`;
      if (!isObj(m) || typeof m.name !== 'string') return err(path, 'must be an object with a "name"');
      const key = String(m.key ?? m.name);
      if (modules.has(key)) return err(path, `duplicate module key "${key}" (also at ${modules.get(key).path})`);
      modules.set(key, { item: m, path });
    });
    for (const [key, { item, path }] of modules) {
      if (item.parent != null && !modules.has(String(item.parent))) err(`${path}.parent`, `unknown module "${item.parent}"`);
      if (item.parent != null && String(item.parent) === key) err(`${path}.parent`, 'a module cannot be its own parent');
    }

    const objects = new Map(); // key -> {item, path, parentKey}
    const order = []; // parents before children
    const walk = (list, parentKey, basePath) => {
      arr(list, basePath).forEach((o, i) => {
        const path = `${basePath}[${i}]`;
        if (!isObj(o) || typeof o.name !== 'string' || typeof o.type !== 'string') {
          return err(path, 'must be an object with "type" and "name"');
        }
        const key = String(o.key ?? (parentKey ? `${parentKey}.${o.name}` : o.name));
        if (objects.has(key)) {
          return err(path, `duplicate object key "${key}" (also at ${objects.get(key).path}); add a unique "key"`);
        }
        if (o.module != null && !modules.has(String(o.module))) err(`${path}.module`, `unknown module "${o.module}"`);
        const entry = { item: o, path, key, parentKey };
        objects.set(key, entry);
        order.push(entry);
        if (objects.size > MAX_OBJECTS) throw badRequest(`Import is limited to ${MAX_OBJECTS} objects.`);
        walk(o.children, key, `${path}.children`);
      });
    };
    walk(doc.objects, null, 'objects');

    // Lenient lookup: "Villager.move_to" also matches "Villager.move_to()".
    const loose = new Map();
    for (const key of objects.keys()) if (!loose.has(stripCall(key))) loose.set(stripCall(key), key);
    const resolve = (ref) => {
      if (ref == null) return null;
      const s = String(ref);
      return objects.has(s) ? s : loose.get(stripCall(s)) ?? undefined;
    };
    const refCheck = (ref, path) => {
      const key = resolve(ref);
      if (key === undefined) err(path, `unknown object "${ref}"`);
      return key;
    };

    const relationships = arr(doc.relationships, 'relationships').map((r, i) => {
      const path = `relationships[${i}]`;
      if (!isObj(r)) return err(path, 'must be an object');
      return { item: r, path, source: refCheck(r.source, `${path}.source`), target: refCheck(r.target, `${path}.target`) };
    }).filter(Boolean);
    const tasks = arr(doc.tasks, 'tasks').map((t, i) => {
      const path = `tasks[${i}]`;
      if (!isObj(t)) return err(path, 'must be an object');
      if (t.module != null && !modules.has(String(t.module))) err(`${path}.module`, `unknown module "${t.module}"`);
      return { item: t, path, object: refCheck(t.object, `${path}.object`) };
    }).filter(Boolean);
    const notes = arr(doc.notes, 'notes').map((n, i) => {
      const path = `notes[${i}]`;
      if (!isObj(n)) return err(path, 'must be an object');
      return { item: n, path, object: refCheck(n.object, `${path}.object`) };
    }).filter(Boolean);
    const positions = arr(isObj(doc.canvas) ? doc.canvas.positions : undefined, 'canvas.positions').map((p, i) => {
      const path = `canvas.positions[${i}]`;
      if (!isObj(p)) return err(path, 'must be an object');
      return { item: p, path, object: refCheck(p.object, `${path}.object`) };
    }).filter(Boolean);

    return { errors, modules, objects, order, relationships, tasks, notes, positions };
  }

  function importProject(doc) {
    const plan = analyse(doc);
    if (plan.errors.length) throw new AppError(400, 'IMPORT_INVALID', 'The import file is invalid.', plan.errors);

    // Pass 2: create everything through the normal services, so every business
    // rule (parent types, inheritance cycles, duplicates...) applies identically.
    // One transaction: any failure rolls the whole import back.
    let step = 'project';
    const run = repos.db.transaction(() => {
      const p = doc.project;
      const project = services.projects.create({ name: p.name, description: p.description ?? '' });
      const pid = project.id;

      const moduleIds = new Map();
      const createModule = (key, seen = new Set()) => {
        if (moduleIds.has(key)) return moduleIds.get(key);
        if (seen.has(key)) throw badRequest('module parents form a cycle');
        seen.add(key);
        const { item, path } = plan.modules.get(key);
        const parentId = item.parent != null ? createModule(String(item.parent), seen) : null;
        step = path;
        const m = services.modules.create(pid, {
          name: item.name, description: item.description, color: item.color, parent_module_id: parentId,
        });
        moduleIds.set(key, m.id);
        return m.id;
      };
      for (const key of plan.modules.keys()) createModule(key);

      const objectIds = new Map();
      for (const { item, path, key, parentKey } of plan.order) {
        step = path;
        const o = services.objects.create(pid, {
          type: item.type,
          name: item.name,
          description: item.description,
          parent_id: parentKey ? objectIds.get(parentKey) : null,
          module_id: item.module != null ? moduleIds.get(String(item.module)) : null,
          health_status: item.health_status,
          implementation_status: item.implementation_status,
          visibility: item.visibility,
          file_path: item.file_path,
          metadata: item.metadata,
        });
        objectIds.set(key, o.id);
      }

      for (const { item, path, source, target } of plan.relationships) {
        step = path;
        services.relationships.create(pid, {
          source_id: objectIds.get(source), target_id: objectIds.get(target), type: item.type,
          description: item.description, health_status: item.health_status, metadata: item.metadata,
        });
      }
      for (const { item, path, object } of plan.tasks) {
        step = path;
        services.tasks.create(pid, {
          title: item.title, description: item.description, status: item.status, priority: item.priority,
          due_date: item.due_date, linked_object_id: object ? objectIds.get(object) : null,
          module_id: item.module != null ? moduleIds.get(String(item.module)) : null,
        });
      }
      for (const { item, path, object } of plan.notes) {
        step = path;
        services.notes.create(pid, {
          title: item.title, content: item.content, type: item.type,
          linked_object_id: object ? objectIds.get(object) : null,
        });
      }
      if (plan.positions.length) {
        step = 'canvas.positions';
        const canvas = services.projects.defaultCanvas(pid);
        services.canvas.savePositions(canvas.id, {
          positions: plan.positions.map(({ item, object }) => ({
            object_id: objectIds.get(object), x: item.x, y: item.y, collapsed: Boolean(item.collapsed),
          })),
        });
      }
      return {
        project,
        counts: {
          modules: moduleIds.size, objects: objectIds.size, relationships: plan.relationships.length,
          tasks: plan.tasks.length, notes: plan.notes.length,
        },
      };
    });

    try {
      return run();
    } catch (e) {
      if (e instanceof AppError) {
        throw new AppError(400, 'IMPORT_INVALID', 'The import file is invalid.', [{ path: step, message: e.message }]);
      }
      throw e;
    }
  }

  return { exportProject, importProject, analyse };
}
