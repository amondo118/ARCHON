import { validate } from '../utils/validate.js';
import { newId, now } from '../utils/ids.js';
import { mustGet, checkRef } from './common.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../domain/types.js';

const SPEC = {
  title: { type: 'string', required: true, max: 300 },
  description: { type: 'string', max: 20000 },
  status: { type: 'string', enum: TASK_STATUSES },
  priority: { type: 'string', enum: TASK_PRIORITIES },
  due_date: { type: 'date', nullable: true },
  module_id: { type: 'string', nullable: true },
  linked_object_id: { type: 'string', nullable: true },
  sort_order: { type: 'integer' },
};

export function tasksService(repos, projects) {
  const { tasks } = repos;
  const checkRefs = (projectId, data) => {
    checkRef(repos.modules, data.module_id, projectId, 'Module');
    checkRef(repos.objects, data.linked_object_id, projectId, 'Linked object');
  };

  const service = {
    list: (projectId) => {
      projects.get(projectId);
      return tasks.listByProject(projectId);
    },
    get: (id) => mustGet(tasks, id, 'Task'),
    create(projectId, input) {
      projects.get(projectId);
      const data = validate(input, SPEC);
      checkRefs(projectId, data);
      const ts = now();
      return tasks.insert({
        id: newId(), project_id: projectId, description: '', status: 'backlog', priority: 'medium',
        sort_order: Date.now(), ...data, created_at: ts, updated_at: ts,
      });
    },
    update(id, input) {
      const task = service.get(id);
      const data = validate(input, SPEC, { partial: true });
      checkRefs(task.project_id, data);
      return tasks.update(id, { ...data, updated_at: now() });
    },
    remove(id) {
      service.get(id);
      tasks.remove(id);
    },
  };
  return service;
}
