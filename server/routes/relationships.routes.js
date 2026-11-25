import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function relationshipsRoutes(services) {
  const s = services.relationships;
  const r = Router();
  r.get('/projects/:projectId/relationships', (req, res) => ok(res, s.list(req.params.projectId)));
  r.post('/projects/:projectId/relationships', (req, res) => ok(res, s.create(req.params.projectId, req.body), 201));
  r.get('/relationships/:id', (req, res) => ok(res, s.get(req.params.id)));
  r.patch('/relationships/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/relationships/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  return r;
}
