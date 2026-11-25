import { api } from '../api/client.js';
import { emitter } from './events.js';
import { saver } from './saver.js';

/**
 * Client-side cache of the current project's data. SQLite stays the source of
 * truth: every mutation goes through the API first and the cache is updated
 * from the server's response.
 */
const bus = emitter();

export const store = {
  on: bus.on,
  meta: null,
  projects: [],
  projectId: null,
  project: null,
  modules: [],
  objects: new Map(),
  relationships: new Map(),
  canvas: null,
  positions: new Map(), // object_id -> { x, y, collapsed }
  selectedId: null,
  moduleFilter: null,

  async init() {
    [this.meta, this.projects] = await Promise.all([api.meta(), api.projects.list()]);
  },

  async refreshProjects() {
    this.projects = await api.projects.list();
    bus.emit('projects');
  },

  async loadProject(id) {
    await saver.flush();
    const g = await api.projects.graph(id);
    if (this.projectId !== id) {
      this.selectedId = null;
      this.moduleFilter = null;
    }
    this.projectId = id;
    this.project = g.project;
    this.modules = g.modules;
    this.objects = new Map(g.objects.map((o) => [o.id, o]));
    this.relationships = new Map(g.relationships.map((r) => [r.id, r]));
    this.canvas = g.canvas;
    this.positions = new Map(g.positions.map((p) => [p.object_id, { x: p.x, y: p.y, collapsed: p.collapsed }]));
    if (this.selectedId && !this.objects.has(this.selectedId)) this.selectedId = null;
    bus.emit('graph');
    bus.emit('selection');
  },

  reload() {
    return this.projectId ? this.loadProject(this.projectId) : Promise.resolve();
  },

  unloadProject() {
    this.projectId = null;
    this.project = null;
    this.objects = new Map();
    this.relationships = new Map();
    this.positions = new Map();
    this.modules = [];
    this.selectedId = null;
  },

  select(id) {
    this.selectedId = id;
    bus.emit('selection');
  },

  /** Select an object and ask the canvas to center on it. */
  focus(id) {
    this.select(id);
    bus.emit('focus', id);
  },

  setModuleFilter(id) {
    this.moduleFilter = id;
    bus.emit('filter');
  },

  // ---- helpers ----
  childrenOf(id) {
    return [...this.objects.values()].filter((o) => o.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
  },
  pathOf(id) {
    const names = [];
    for (let o = this.objects.get(id); o; o = this.objects.get(o.parent_id)) names.unshift(o.name);
    return names.join('.');
  },
  moduleName(id) {
    return this.modules.find((m) => m.id === id)?.name ?? null;
  },

  // ---- projects ----
  createProject(body) {
    return api.projects.create(body);
  },
  async updateProject(patch) {
    this.project = await saver.track(api.projects.update(this.projectId, patch));
    await this.refreshProjects();
    bus.emit('project');
  },

  // ---- modules ----
  async createModule(body) {
    const m = await saver.track(api.modules.create(this.projectId, body));
    this.modules.push(m);
    bus.emit('modules');
    return m;
  },
  async updateModule(id, patch) {
    const m = await saver.track(api.modules.update(id, patch));
    this.modules = this.modules.map((x) => (x.id === id ? m : x));
    bus.emit('modules');
    bus.emit('graph');
  },
  async removeModule(id) {
    await saver.track(api.modules.remove(id));
    if (this.moduleFilter === id) this.moduleFilter = null;
    await this.reload();
    bus.emit('modules');
  },

  // ---- objects ----
  async createObject(body) {
    const o = await saver.track(api.objects.create(this.projectId, body));
    this.objects.set(o.id, o);
    bus.emit('graph');
    return o;
  },
  async updateObject(id, patch) {
    const o = await saver.track(api.objects.update(id, patch));
    // Module changes cascade to descendants on the server; resync in that case.
    if ('module_id' in patch || 'parent_id' in patch) return this.reload();
    this.objects.set(id, o);
    bus.emit('graph');
    bus.emit('object', id);
    return o;
  },
  impact(id) {
    return api.objects.impact(id);
  },
  async removeObject(id) {
    await saver.flush(); // don't let queued position writes reference a deleted object
    await saver.track(api.objects.remove(id));
    if (this.selectedId === id) this.selectedId = null;
    await this.reload();
  },

  // ---- relationships ----
  async createRelationship(body) {
    const r = await saver.track(api.relationships.create(this.projectId, body));
    this.relationships.set(r.id, r);
    bus.emit('graph');
    bus.emit('object', r.source_id);
    return r;
  },
  async updateRelationship(id, patch) {
    const r = await saver.track(api.relationships.update(id, patch));
    this.relationships.set(id, r);
    bus.emit('graph');
    bus.emit('object', r.source_id);
    return r;
  },
  async removeRelationship(id) {
    await saver.track(api.relationships.remove(id));
    this.relationships.delete(id);
    bus.emit('graph');
    bus.emit('object', null);
  },

  // ---- canvas positions (batched + debounced) ----
  _dirty: new Map(),
  _removed: new Set(),
  setPositions(entries) {
    for (const [id, p] of entries) {
      const next = { ...(this.positions.get(id) ?? { collapsed: false }), ...p };
      this.positions.set(id, next);
      this._dirty.set(id, next);
      this._removed.delete(id);
    }
    this._schedulePositions();
  },
  removePosition(id) {
    this.positions.delete(id);
    this._dirty.delete(id);
    this._removed.add(id);
    this._schedulePositions();
  },
  /** Show a child as its own canvas node (presentation only; parent_id is unchanged). */
  promote(id) {
    let anchor = null;
    for (let o = this.objects.get(this.objects.get(id)?.parent_id); o && !anchor; o = this.objects.get(o.parent_id)) {
      anchor = this.positions.get(o.id);
    }
    const siblings = this.childrenOf(this.objects.get(id).parent_id);
    const offset = Math.max(0, siblings.findIndex((s) => s.id === id)) * 30;
    this.setPositions([[id, { x: (anchor?.x ?? 0) + 320, y: (anchor?.y ?? 0) + offset, collapsed: false }]]);
    bus.emit('graph');
  },
  /** Return a promoted child to its parent's card. */
  unpromote(id) {
    this.removePosition(id);
    bus.emit('graph');
  },
  isPromoted(id) {
    return Boolean(this.objects.get(id)?.parent_id) && this.positions.has(id);
  },
  setCollapsed(id, collapsed) {
    if (!this.positions.has(id)) return; // only placed canvas nodes can collapse
    this.setPositions([[id, { collapsed }]]);
    bus.emit('graph');
  },
  _schedulePositions() {
    const canvasId = this.canvas.id;
    saver.schedule('positions', () => {
      const positions = [...this._dirty].map(([object_id, p]) => ({ object_id, x: p.x, y: p.y, collapsed: !!p.collapsed }));
      const remove = [...this._removed];
      this._dirty.clear();
      this._removed.clear();
      if (!positions.length && !remove.length) return null;
      return api.canvas.savePositions(canvasId, { positions, remove });
    }, 500);
  },
};
