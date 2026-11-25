import { h, icon } from '../core/dom.js';
import { store } from '../core/store.js';
import { api } from '../api/client.js';
import { saver } from '../core/saver.js';
import { openModal } from '../components/modal.js';
import { pickAndImport } from '../components/importer.js';
import { toast, toastError } from '../components/toast.js';

/** Project settings and data portability (export, import, backup, delete). */
export function mountSettings(container, { onProjectDeleted, onImported }) {
  const p = store.project;
  const name = h('input', { class: 'input', value: p.name, maxlength: 200 });
  const desc = h('textarea', { class: 'input', rows: 3 }, p.description);
  const saveProject = async () => {
    if (!name.value.trim()) return toast('Project name cannot be empty.', 'error');
    try {
      await store.updateProject({ name: name.value, description: desc.value });
      toast('Project saved.', 'success');
    } catch (e) { toastError(e); }
  };

  container.append(h('div', { class: 'settings' },
    h('h1', { class: 'page-title' }, 'Settings'),
    h('p', { class: 'page-sub' }, 'Project details and data portability.'),

    h('div', { class: 'panel' }, h('h3', {}, 'Project'),
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Description'), desc),
      h('button', { class: 'btn primary', onClick: saveProject }, 'Save')),

    h('div', { class: 'panel' }, h('h3', {}, 'Export & import'),
      h('p', {}, 'Export this project as an ARCHON JSON file. Importing a file always creates a new project, so nothing is overwritten. You can also drop a .json file anywhere in the window.'),
      h('div', { class: 'btn-group' },
        h('a', { class: 'btn', href: api.projects.exportUrl(p.id), download: '' }, icon('download'), 'Export JSON'),
        h('button', { class: 'btn', onClick: () => pickAndImport(onImported) }, icon('upload'), 'Import JSON'))),

    h('div', { class: 'panel' }, h('h3', {}, 'Database backup'),
      h('p', {}, 'Download a consistent snapshot of the whole ARCHON database (all projects). A copy is also kept in the server\'s backup directory.'),
      h('button', { class: 'btn', onClick: backup }, icon('database'), 'Download backup')),

    h('div', { class: 'panel danger-zone' }, h('h3', {}, 'Delete project'),
      h('p', {}, 'Permanently deletes this project with all its modules, objects, relationships, tasks and notes. Export it first if you may need it again.'),
      h('button', { class: 'btn danger', onClick: deleteProject }, icon('trash-2'), 'Delete project…'))));

  async function backup() {
    try {
      const res = await saver.track(api.backup());
      const blob = await res.blob();
      const filename = /filename="?([^";]+)/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'archon-backup.db';
      const a = h('a', { href: URL.createObjectURL(blob), download: filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Backup created.', 'success');
    } catch (e) { toastError(e); }
  }

  async function deleteProject() {
    const confirmInput = h('input', { class: 'input', placeholder: p.name });
    const result = await openModal({
      title: 'Delete project?',
      body: h('div', {},
        h('p', { style: 'margin-top:0' }, 'This cannot be undone. Type the project name to confirm:'),
        h('p', { class: 'mono' }, p.name), confirmInput),
      initialFocus: confirmInput,
      actions: [{ label: 'Cancel', value: false }, {
        label: 'Delete project', kind: 'danger solid', submit: true, value: true,
        onClick: () => {
          if (confirmInput.value !== p.name) { toast('The name does not match.', 'error'); return false; }
        },
      }],
    });
    if (result !== true) return;
    try {
      await saver.track(api.projects.remove(p.id));
      toast(`Deleted "${p.name}".`, 'success');
      onProjectDeleted();
    } catch (e) { toastError(e); }
  }
  return () => {};
}
