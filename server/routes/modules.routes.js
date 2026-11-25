import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function modulesRoutes(services) {
  const s = services.modules;
  const r = Router();
  r.get('/projects/:projectId/modules', (req, res) => ok(res, s.list(req.params.projectId)));
  r.post('/projects/:projectId/modules', (req, res) => ok(res, s.create(req.params.projectId, req.body), 201));
  r.get('/modules/:id', (req, res) => ok(res, s.get(req.params.id)));
  r.patch('/modules/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/modules/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  return r;
}
