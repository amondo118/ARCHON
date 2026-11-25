import { Router } from 'express';
import { ok } from '../utils/respond.js';

export function canvasesRoutes(services) {
  const s = services.canvas;
  const r = Router();
  r.get('/projects/:projectId/canvases', (req, res) => ok(res, s.list(req.params.projectId)));
  r.put('/canvases/:id/positions', (req, res) => ok(res, s.savePositions(req.params.id, req.body)));
  return r;
}
