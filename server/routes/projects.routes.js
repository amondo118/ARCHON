import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function projectsRoutes(services) {
  const s = services.projects;
  const r = Router();
  r.get('/projects', (req, res) => ok(res, s.list()));
  r.post('/projects', (req, res) => ok(res, s.create(req.body), 201));
  r.get('/projects/:id', (req, res) => ok(res, s.get(req.params.id)));
  r.patch('/projects/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/projects/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  r.get('/projects/:id/stats', (req, res) => ok(res, s.stats(req.params.id)));
  r.get('/projects/:id/graph', (req, res) => ok(res, services.graph(req.params.id)));
  return r;
}
