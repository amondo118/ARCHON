import { validate } from '../utils/validate.js';
import { badRequest } from '../utils/errors.js';
import { newId, now } from '../utils/ids.js';
import { mustGet, checkRef } from './common.js';

const SPEC = {
  name: { type: 'string', required: true, max: 200 },
  description: { type: 'string', max: 5000 },
  parent_module_id: { type: 'string', nullable: true },
  color: { type: 'string', nullable: true, max: 32 },
  sort_order: { type: 'integer' },
};

export function modulesService(repos, projects) {
  const { modules } = repos;

  const assertNoCycle = (moduleId, newParentId) => {
    for (let cur = newParentId; cur; cur = modules.get(cur)?.parent_module_id) {
      if (cur === moduleId) throw badRequest('A module cannot be nested inside itself.');
    }
  };

  const service = {
    list: (projectId) => {
      projects.get(projectId);
      return modules.listByProject(projectId);
    },
    get: (id) => mustGet(modules, id, 'Module'),

    create(projectId, input) {
      projects.get(projectId);
      const data = validate(input, SPEC);
      checkRef(modules, data.parent_module_id, projectId, 'Parent module');
      const ts = now();
      const row = modules.insert({
        id: newId(), project_id: projectId, description: '', sort_order: 0, ...data, created_at: ts, updated_at: ts,
      });
      projects.touch(projectId);
      return row;
    },

    update(id, input) {
      const mod = service.get(id);
      const data = validate(input, SPEC, { partial: true });
      if (data.parent_module_id !== undefined) {
        checkRef(modules, data.parent_module_id, mod.project_id, 'Parent module');
        assertNoCycle(id, data.parent_module_id);
      }
      const row = modules.update(id, { ...data, updated_at: now() });
      projects.touch(mod.project_id);
      return row;
    },

    /** Deleting a module never deletes architecture: sub-modules move up a level and objects become unassigned. */
    remove(id) {
      const mod = service.get(id);
      repos.db.transaction(() => {
        modules.reparentChildren(id, mod.parent_module_id);
        modules.remove(id);
        projects.touch(mod.project_id);
      })();
    },
  };
  return service;
}
