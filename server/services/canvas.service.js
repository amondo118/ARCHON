import { badRequest } from '../utils/errors.js';
import { validate } from '../utils/validate.js';
import { now } from '../utils/ids.js';
import { mustGet } from './common.js';

const POSITION_SPEC = {
  object_id: { type: 'string', required: true },
  x: { type: 'number', required: true },
  y: { type: 'number', required: true },
  collapsed: { type: 'boolean' },
};
const MAX_BATCH = 5000;

export function canvasService(repos, projects) {
  const { canvases, positions, objects } = repos;

  const service = {
    list: (projectId) => {
      projects.get(projectId);
      projects.defaultCanvas(projectId);
      return canvases.listByProject(projectId);
    },
    get: (id) => mustGet(canvases, id, 'Canvas'),

    /**
     * Upsert positions and remove rows (un-promote / reset).
     * body: { positions: [{object_id, x, y, collapsed}], remove: [object_id] }
     */
    savePositions(canvasId, body) {
      const canvas = service.get(canvasId);
      const upserts = body?.positions ?? [];
      const removals = body?.remove ?? [];
      if (!Array.isArray(upserts) || !Array.isArray(removals)) throw badRequest('"positions" and "remove" must be arrays.');
      if (upserts.length + removals.length > MAX_BATCH) throw badRequest(`At most ${MAX_BATCH} changes per request.`);

      const belongs = (id) => {
        const obj = typeof id === 'string' ? objects.get(id) : null;
        if (!obj || obj.project_id !== canvas.project_id) throw badRequest(`Object ${id} does not exist in this project.`);
      };
      const rows = upserts.map((p) => {
        const data = validate(p, POSITION_SPEC);
        belongs(data.object_id);
        return { canvas_id: canvasId, object_id: data.object_id, x: data.x, y: data.y, collapsed: data.collapsed ? 1 : 0 };
      });
      removals.forEach(belongs);

      repos.db.transaction(() => {
        for (const r of rows) positions.upsert.run(r);
        for (const id of removals) positions.remove.run(canvasId, id);
        canvases.update(canvasId, { updated_at: now() });
      })();
      return { saved: rows.length, removed: removals.length };
    },
  };
  return service;
}
