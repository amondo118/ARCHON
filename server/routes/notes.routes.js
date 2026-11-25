import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function notesRoutes(services) {
  const s = services.notes;
  const r = Router();
  r.get('/projects/:projectId/notes', (req, res) => ok(res, s.list(req.params.projectId)));
  r.post('/projects/:projectId/notes', (req, res) => ok(res, s.create(req.params.projectId, req.body), 201));
  r.get('/notes/:id', (req, res) => ok(res, s.get(req.params.id)));
  r.patch('/notes/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/notes/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  return r;
}
