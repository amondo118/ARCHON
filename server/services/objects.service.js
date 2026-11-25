import { validate } from '../utils/validate.js';
import { badRequest } from '../utils/errors.js';
import { newId, now } from '../utils/ids.js';
import { mustGet, checkRef } from './common.js';
import {
  OBJECT_TYPES, HEALTH_STATUSES, IMPLEMENTATION_STATUSES, VISIBILITIES, parentRuleError, isContainer,
} from '../domain/types.js';

const SPEC = {
  type: { type: 'string', required: true, enum: OBJECT_TYPES },
  name: { type: 'string', required: true, max: 300 },
  description: { type: 'string', max: 20000 },
  parent_id: { type: 'string', nullable: true },
  module_id: { type: 'string', nullable: true },
  health_status: { type: 'string', enum: HEALTH_STATUSES },
  implementation_status: { type: 'string', enum: IMPLEMENTATION_STATUSES },
  visibility: { type: 'string', enum: VISIBILITIES },
  file_path: { type: 'string', nullable: true, max: 1000 },
  metadata: { type: 'object' },
  sort_order: { type: 'integer' },
};

export function objectsService(repos, projects) {
  const { objects, relationships, tasks, notes } = repos;

  const assertParent = (projectId, type, parentId, selfId) => {
    const parent = checkRef(objects, parentId, projectId, 'Parent object');
    const err = parentRuleError(type, parent?.type ?? null);
    if (err) throw badRequest(err);
    if (selfId && parent) {
      if (parent.id === selfId || objects.descendantIds(selfId).includes(parent.id)) {
        throw badRequest('An object cannot be placed inside itself or one of its children.');
      }
    }
    return parent;
  };

  const service = {
    list: (projectId) => {
      projects.get(projectId);
      return objects.listByProject(projectId);
    },
    get: (id) => mustGet(objects, id, 'Object'),

    /** Object with its children, relationships, tasks and notes for the inspector. */
    details(id) {
      const object = service.get(id);
      const { incoming, outgoing } = relationships.forObject(id);
      return {
        object,
        children: objects.children(id),
        incoming,
        outgoing,
        tasks: tasks.listByProject(object.project_id).filter((t) => t.linked_object_id === id),
        notes: notes.listByProject(object.project_id).filter((n) => n.linked_object_id === id),
      };
    },

    create(projectId, input) {
      projects.get(projectId);
      const data = validate(input, SPEC);
      const parent = assertParent(projectId, data.type, data.parent_id ?? null);
      // Children always live in their parent's module.
      const moduleId = parent ? parent.module_id : data.module_id ?? null;
      checkRef(repos.modules, moduleId, projectId, 'Module');
      const ts = now();
      const row = objects.insert({
        id: newId(),
        project_id: projectId,
        description: '',
        health_status: 'unreviewed',
        implementation_status: 'planned',
        visibility: 'none',
        metadata: {},
        sort_order: objects.maxChildOrder(parent?.id ?? null) + 1,
        ...data,
        parent_id: parent?.id ?? null,
        module_id: moduleId,
        created_at: ts,
        updated_at: ts,
      });
      projects.touch(projectId);
      return row;
    },

    update(id, input) {
      const current = service.get(id);
      const data = validate(input, SPEC, { partial: true });
      const type = data.type ?? current.type;
      const parentId = data.parent_id !== undefined ? data.parent_id : current.parent_id;

      return repos.db.transaction(() => {
        if (data.type !== undefined || data.parent_id !== undefined) {
          const parent = assertParent(current.project_id, type, parentId, id);
          if (!isContainer(type) && objects.children(id).length) {
            throw badRequest(`Cannot change to "${type}": this object has children, and a ${type} cannot contain objects.`);
          }
          if (parent) data.module_id = parent.module_id;
        }
        if (data.module_id !== undefined) {
          if (parentId && data.parent_id === undefined && data.module_id !== current.module_id) {
            throw badRequest('Child objects always use their parent\'s module. Change the parent\'s module instead.');
          }
          checkRef(repos.modules, data.module_id, current.project_id, 'Module');
          objects.setModuleForDescendants(id, data.module_id);
        }
        const row = objects.update(id, { ...data, updated_at: now() });
        projects.touch(current.project_id);
        return row;
      })();
    },

    /** What a deletion would affect, for the confirmation dialog. */
    deleteImpact(id) {
      const object = service.get(id);
      const descendants = objects.descendantIds(id);
      const all = [id, ...descendants];
      return {
        object: { id: object.id, name: object.name, type: object.type },
        children: descendants.length,
        relationships: relationships.countTouching(all),
        tasks: tasks.countLinked(all),
        notes: notes.countLinked(all),
      };
    },

    /** Deletes the object and its descendants; relationships go with them, tasks/notes are unlinked. */
    remove(id) {
      const object = service.get(id);
      repos.db.transaction(() => {
        objects.remove(id);
        projects.touch(object.project_id);
      })();
    },
  };
  return service;
}
