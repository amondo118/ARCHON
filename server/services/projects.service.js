import { validate } from '../utils/validate.js';
import { newId, now } from '../utils/ids.js';
import { mustGet } from './common.js';

const SPEC = {
  name: { type: 'string', required: true, max: 200 },
  description: { type: 'string', max: 5000 },
};

export function projectsService(repos) {
  const { projects, canvases } = repos;

  const service = {
    list: () => projects.list(),
    get: (id) => mustGet(projects, id, 'Project'),

    create(input) {
      const data = validate(input, SPEC);
      return repos.db.transaction(() => {
        const ts = now();
        const project = projects.insert({ id: newId(), description: '', ...data, created_at: ts, updated_at: ts });
        service.defaultCanvas(project.id);
        return project;
      })();
    },

    update(id, input) {
      service.get(id);
      const data = validate(input, SPEC, { partial: true });
      return projects.update(id, { ...data, updated_at: now() });
    },

    remove(id) {
      service.get(id);
      projects.remove(id);
    },

    stats(id) {
      return { project: service.get(id), ...projects.stats(id) };
    },

    /** v0.1 uses one canvas per project; it is created on demand. */
    defaultCanvas(projectId) {
      const [existing] = canvases.listByProject(projectId);
      if (existing) return existing;
      const ts = now();
      return canvases.insert({ id: newId(), project_id: projectId, name: 'Main', config: {}, created_at: ts, updated_at: ts });
    },

    /** Touch the project's updated_at whenever its content changes. */
    touch(projectId) {
      projects.update(projectId, { updated_at: now() });
    },
  };
  return service;
}
