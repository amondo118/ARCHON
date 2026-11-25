import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServices } from './services/index.js';
import { META } from './domain/types.js';
import { ok } from './utils/respond.js';
import { errorHandler, notFoundApi, securityHeaders } from './middleware/errors.js';
import { projectsRoutes } from './routes/projects.routes.js';
import { modulesRoutes } from './routes/modules.routes.js';
import { objectsRoutes } from './routes/objects.routes.js';
import { relationshipsRoutes } from './routes/relationships.routes.js';
import { tasksRoutes } from './routes/tasks.routes.js';
import { notesRoutes } from './routes/notes.routes.js';
import { canvasesRoutes } from './routes/canvases.routes.js';
import { transferRoutes } from './routes/transfer.routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = (p) => path.join(ROOT, 'node_modules', p);

// Browser libraries are served from node_modules (versions pinned by the lockfile, no CDN).
const VENDOR = {
  '/vendor/cytoscape': modulePath('cytoscape/dist'),
  '/vendor/marked': modulePath('marked/lib'),
  '/vendor/dompurify': modulePath('dompurify/dist'),
  '/vendor/icons': modulePath('lucide-static/icons'),
};

export function createApp(db, config) {
  const services = createServices(db, config);
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  const api = express.Router();
  api.use(express.json({ limit: config.importLimit }));
  api.get('/health', (req, res) => {
    db.prepare('SELECT 1').get();
    ok(res, { status: 'ok' });
  });
  api.get('/meta', (req, res) => ok(res, META));
  for (const routes of [projectsRoutes, modulesRoutes, objectsRoutes, relationshipsRoutes, tasksRoutes,
    notesRoutes, canvasesRoutes, transferRoutes]) {
    api.use(routes(services));
  }
  api.use(notFoundApi);
  app.use('/api/v1', api);

  for (const [url, dir] of Object.entries(VENDOR)) app.use(url, express.static(dir, { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public')));
  app.use(errorHandler);
  return { app, services };
}
