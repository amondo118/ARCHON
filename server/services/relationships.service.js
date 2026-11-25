import { validate } from '../utils/validate.js';
import { badRequest, conflict } from '../utils/errors.js';
import { newId, now } from '../utils/ids.js';
import { mustGet } from './common.js';
import { RELATIONSHIP_TYPES, HEALTH_STATUSES, relationshipRuleError } from '../domain/types.js';

const CREATE_SPEC = {
  source_id: { type: 'string', required: true },
  target_id: { type: 'string', required: true },
  type: { type: 'string', required: true, enum: RELATIONSHIP_TYPES },
  health_status: { type: 'string', enum: HEALTH_STATUSES },
  description: { type: 'string', max: 5000 },
  metadata: { type: 'object' },
};
// Endpoints are immutable: to move a relationship, delete and recreate it.
const UPDATE_SPEC = {
  type: CREATE_SPEC.type,
  health_status: CREATE_SPEC.health_status,
  description: CREATE_SPEC.description,
  metadata: CREATE_SPEC.metadata,
};

export function relationshipsService(repos, projects) {
  const { objects, relationships } = repos;

  const endpoint = (id, projectId, label) => {
    const obj = objects.get(id);
    // Project ownership comes from the database, never from the client.
    if (!obj || obj.project_id !== projectId) throw badRequest(`${label} object does not exist in this project.`);
    return obj;
  };

  /** Validates type rules, duplicates and inheritance for a (source, target, type) triple. */
  const assertAllowed = (source, target, type, selfId = null) => {
    if (source.id === target.id) throw badRequest('An object cannot have a relationship with itself.');
    const err = relationshipRuleError(type, source, target);
    if (err) throw badRequest(err);
    const dup = relationships.find(source.id, target.id, type);
    if (dup && dup.id !== selfId) throw conflict(`A "${type}" relationship between these objects already exists.`);
    if (type === 'inherits') {
      const existing = relationships.inheritsFrom(source.id);
      if (existing && existing.id !== selfId) {
        throw conflict(`"${source.name}" already inherits from another object (single inheritance).`);
      }
      // Walk the target's inheritance chain; reaching the source would close a cycle.
      const seen = new Set();
      for (let cur = target.id; cur && !seen.has(cur); cur = relationships.inheritsFrom(cur)?.target_id) {
        if (cur === source.id) throw badRequest('This inheritance would create a cycle.');
        seen.add(cur);
      }
    }
  };

  const service = {
    list: (projectId) => {
      projects.get(projectId);
      return relationships.listByProject(projectId);
    },
    get: (id) => mustGet(relationships, id, 'Relationship'),

    create(projectId, input) {
      projects.get(projectId);
      const data = validate(input, CREATE_SPEC);
      const source = endpoint(data.source_id, projectId, 'Source');
      const target = endpoint(data.target_id, projectId, 'Target');
      assertAllowed(source, target, data.type);
      const ts = now();
      const row = relationships.insert({
        id: newId(), project_id: projectId, health_status: 'unreviewed', description: '', metadata: {},
        ...data, created_at: ts, updated_at: ts,
      });
      projects.touch(projectId);
      return row;
    },

    update(id, input) {
      const current = service.get(id);
      const data = validate(input, UPDATE_SPEC, { partial: true });
      if (data.type && data.type !== current.type) {
        assertAllowed(objects.get(current.source_id), objects.get(current.target_id), data.type, id);
      }
      const row = relationships.update(id, { ...data, updated_at: now() });
      projects.touch(current.project_id);
      return row;
    },

    remove(id) {
      const rel = service.get(id);
      relationships.remove(id);
      projects.touch(rel.project_id);
    },
  };
  return service;
}
