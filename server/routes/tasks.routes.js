import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function tasksRoutes(services) {
  const s = services.tasks;
  const r = Router();
  r.get('/projects/:projectId/tasks', (req, res) => ok(res, s.list(req.params.projectId)));
  r.post('/projects/:projectId/tasks', (req, res) => ok(res, s.create(req.params.projectId, req.body), 201));
  r.get('/tasks/:id', (req, res) => ok(res, s.get(req.params.id)));
  r.patch('/tasks/:id', (req, res) => ok(res, s.update(req.params.id, req.body)));
  r.delete('/tasks/:id', (req, res) => {
    s.remove(req.params.id);
    ok(res, null);
  });
  return r;
}
