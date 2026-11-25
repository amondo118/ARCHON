import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function objectsRoutes(services) {
  const s = services.objects;
  const r = Router();
  r.get('/projects/:projectId/objects', (req, res) => ok(res, s.list(req.params.projectId)));
  r.post('/projects/:projectId/objects', (req, res) => ok(res, s.create(req.params.projectId, req.body), 201));
  r.get('/objects/:id', (req, res) => ok(res, s.details(req.params.id)));
  r.get('/objects/:id/delete-impact', (req, res) => ok(res, s.deleteImpact(req.params.id)));
  r.patch('/objects/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/objects/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  return r;
}
