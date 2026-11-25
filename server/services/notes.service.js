import { validate } from '../utils/validate.js';
import { newId, now } from '../utils/ids.js';
import { mustGet, checkRef } from './common.js';
import { NOTE_TYPES } from '../domain/types.js';

const SPEC = {
  title: { type: 'string', required: true, max: 300 },
  content: { type: 'string', max: 200000 },
  type: { type: 'string', enum: NOTE_TYPES },
  linked_object_id: { type: 'string', nullable: true },
};

export function notesService(repos, projects) {
  const { notes } = repos;
  const service = {
    list: (projectId) => {
      projects.get(projectId);
      return notes.listByProject(projectId);
    },
    get: (id) => mustGet(notes, id, 'Note'),
    create(projectId, input) {
      projects.get(projectId);
      const data = validate(input, SPEC);
      checkRef(repos.objects, data.linked_object_id, projectId, 'Linked object');
      const ts = now();
      return notes.insert({
        id: newId(), project_id: projectId, content: '', type: 'general', ...data, created_at: ts, updated_at: ts,
      });
    },
    update(id, input) {
      const note = service.get(id);
      const data = validate(input, SPEC, { partial: true });
      checkRef(repos.objects, data.linked_object_id, note.project_id, 'Linked object');
      return notes.update(id, { ...data, updated_at: now() });
    },
    remove(id) {
      service.get(id);
      notes.remove(id);
    },
  };
  return service;
}
