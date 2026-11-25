import { Router } from 'express';
import { ok } from '../utils/respond.js';

const safeFilename = (name) => name.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'project';

export function transferRoutes(services) {
  const r = Router();
  r.get('/projects/:id/export', (req, res) => {
    const data = services.transfer.exportProject(req.params.id);
    res.set('Content-Disposition', `attachment; filename="${safeFilename(data.project.name)}.archon.json"`);
    res.json(data); // raw interchange document, not wrapped: the file must be importable as-is
  });
  r.post('/projects/import', (req, res) => ok(res, services.transfer.importProject(req.body), 201));
  r.post('/backup', async (req, res) => {
    const file = await services.backup.create();
    res.download(file);
  });
  return r;
}
