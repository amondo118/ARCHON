import { badRequest, notFound } from '../utils/errors.js';

/** Load a row or throw 404. */
export function mustGet(repo, id, label) {
  const row = id ? repo.get(id) : null;
  if (!row) throw notFound(label);
  return row;
}

/** Ensure an optional referenced row exists and belongs to the project. */
export function checkRef(repo, id, projectId, label) {
  if (id == null) return null;
  const row = repo.get(id);
  if (!row || row.project_id !== projectId) throw badRequest(`${label} does not exist in this project.`);
  return row;
}
