import { createRepositories } from '../repositories/index.js';
import { projectsService } from './projects.service.js';
import { modulesService } from './modules.service.js';
import { objectsService } from './objects.service.js';
import { relationshipsService } from './relationships.service.js';
import { tasksService } from './tasks.service.js';
import { notesService } from './notes.service.js';
import { canvasService } from './canvas.service.js';
import { transferService } from './transfer.service.js';
import { backupService } from './backup.service.js';

export function createServices(db, config) {
  const repos = createRepositories(db);
  const projects = projectsService(repos);
  const services = {
    projects,
    modules: modulesService(repos, projects),
    objects: objectsService(repos, projects),
    relationships: relationshipsService(repos, projects),
    tasks: tasksService(repos, projects),
    notes: notesService(repos, projects),
    canvas: canvasService(repos, projects),
  };
  services.transfer = transferService(repos, services);
  services.backup = backupService(db, config);

  /** Everything the architecture canvas needs, in one round trip. */
  services.graph = (projectId) => {
    const project = projects.get(projectId);
    const canvas = projects.defaultCanvas(projectId);
    return {
      project,
      modules: repos.modules.listByProject(projectId),
      objects: repos.objects.listByProject(projectId),
      relationships: repos.relationships.listByProject(projectId),
      canvas,
      positions: repos.positions.list(canvas.id),
    };
  };
  return services;
}
