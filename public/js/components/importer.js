import { h, icon } from '../core/dom.js';
import { api } from '../api/client.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

/**
 * Import an ARCHON JSON file (export file, or a hand-written / generated one).
 * Resolves with the new project, or null if the import failed (errors are shown).
 */
export async function importFile(file) {
  let doc;
  try {
    doc = JSON.parse(await file.text());
  } catch (e) {
    await showErrors(`"${file.name}" is not valid JSON.`, [{ path: '$', message: e.message }]);
    return null;
  }
  try {
    // Not routed through the save tracker: a rejected file is not a failed save of user edits.
    const { project, counts } = await api.projects.import(doc);
    toast(`Imported "${project.name}": ${counts.objects} objects, ${counts.relationships} relationships.`, 'success');
    return project;
  } catch (e) {
    await showErrors(e.message, e.details ?? []);
    return null;
  }
}

function showErrors(message, details) {
  return openModal({
    title: 'Import failed',
    wide: true,
    body: h('div', {},
      h('p', { style: 'margin-top:0' }, message, ' Nothing was imported.'),
      details.length ? h('ul', { class: 'error-list' }, details.map((d) =>
        h('li', {}, h('span', { class: 'path' }, d.path), ' — ', d.message))) : null,
      h('p', { class: 'hint' }, 'See docs/IMPORT_FORMAT.md for the file format.')),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}

/** Opens a file chooser and imports the chosen file. */
export function pickAndImport(onImported) {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (file) {
      const project = await importFile(file);
      if (project) onImported(project);
    }
  });
  document.body.append(input);
  input.click();
}

/** Lets the user drop a .json file anywhere in the window to import it. */
export function installDropZone(onImported) {
  const overlay = h('div', { class: 'drop-overlay' }, icon('file-json'),
    h('div', {}, 'Drop an ARCHON JSON file to import it as a new project'));
  document.body.append(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    const files = [...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
    if (!files.length) return toast('Only .json files can be imported.', 'error');
    for (const file of files) {
      const project = await importFile(file);
      if (project) onImported(project);
    }
  });
}
