import { h, icon, iconButton, clear } from './core/dom.js';
import { store } from './core/store.js';
import { saver } from './core/saver.js';
import { openModal } from './components/modal.js';
import { toast, toastError } from './components/toast.js';
import { installDropZone, pickAndImport } from './components/importer.js';
import { renderSidebar, syncSidebarSelection, NAV } from './components/sidebar.js';
import { mountArchitecture } from './views/architecture.js';
import { mountInspector } from './views/inspector.js';
import { mountTasks } from './views/tasks.js';
import { mountNotes } from './views/notes.js';
import { mountOverview } from './views/overview.js';
import { mountSettings } from './views/settings.js';

const $ = (id) => document.getElementById(id);
const appEl = $('app');
const LAST_PROJECT = 'archon.lastProject';
const UI_PREFS = 'archon.ui';

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem(UI_PREFS)) ?? {}; } catch { return {}; }
})();
const savePrefs = () => { try { localStorage.setItem(UI_PREFS, JSON.stringify(prefs)); } catch { /* optional */ } };

let route = { projectId: null, view: 'overview', params: {} };
let unmountView = null;
let unmountInspector = null;

// ------------------------------------------------------------------ routing
// #/<projectId>/<view>?key=value
function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [projectId = null, view = 'architecture'] = path.split('/').filter(Boolean);
  return { projectId, view: NAV.some((n) => n.id === view) ? view : 'architecture', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function navigate(view, params = {}, projectId = store.projectId) {
  const q = new URLSearchParams(params).toString();
  location.hash = `#/${projectId}/${view}${q ? `?${q}` : ''}`;
}

async function onRoute() {
  const next = parseHash();
  if (!next.projectId) {
    const last = (() => { try { return localStorage.getItem(LAST_PROJECT); } catch { return null; } })();
    const target = store.projects.find((p) => p.id === last) ?? store.projects[0];
    if (target) return navigate('architecture', {}, target.id);
    store.unloadProject();
    route = next;
    return renderAll();
  }
  try {
    if (next.projectId !== store.projectId) await store.loadProject(next.projectId);
  } catch (e) {
    toastError(e);
    location.hash = '';
    return;
  }
  try { localStorage.setItem(LAST_PROJECT, next.projectId); } catch { /* optional */ }
  route = next;
  renderAll();
}

// ------------------------------------------------------------------ rendering
function renderAll() {
  renderSidebar($('sidebar'), { view: route.view, navigate, newProject, importJson });
  renderTopbar();
  mountView();
}

function renderTopbar() {
  const saveState = h('span', { class: 'save-state', role: 'status' });
  const updateSave = (s) => {
    saveState.className = `save-state ${s}`;
    saveState.textContent = { saving: 'Saving…', saved: 'Saved', failed: 'Save failed' }[s];
  };
  updateSave(saver.state());
  topbarSaveOff?.();
  topbarSaveOff = saver.onChange(updateSave);

  const title = NAV.find((n) => n.id === route.view)?.label ?? '';
  clear($('topbar')).append(...[
    iconButton('panel-left', 'Toggle sidebar', () => togglePanel('sidebar')),
    h('span', { class: 'title' }, store.project ? `${store.project.name}` : 'ARCHON'),
    store.project ? h('span', { class: 'muted' }, ` / ${title}`) : null,
    h('span', { class: 'spacer' }),
    saveState,
    route.view === 'architecture' && store.project ? iconButton('panel-right', 'Toggle inspector', () => togglePanel('inspector')) : null,
  ].filter(Boolean));
}
let topbarSaveOff = null;

function togglePanel(which) {
  prefs[which] = prefs[which] === false;
  savePrefs();
  applyPanels();
  window.dispatchEvent(new Event('resize')); // let the canvas re-measure
}

function applyPanels() {
  appEl.classList.toggle('no-sidebar', prefs.sidebar === false);
  const inspectorWanted = route.view === 'architecture' && store.projectId && prefs.inspector !== false;
  appEl.classList.toggle('no-inspector', !inspectorWanted);
}

function mountView() {
  unmountView?.();
  unmountInspector?.();
  unmountView = unmountInspector = null;
  applyPanels();
  const main = clear($('main'));
  const inspector = clear($('inspector'));

  if (!store.projectId) {
    main.append(h('div', { class: 'view' }, emptyState()));
    return;
  }
  const view = h('div', { class: `view ${route.view === 'architecture' ? 'flush' : ''}` });
  main.append(view);
  switch (route.view) {
    case 'overview': unmountView = mountOverview(view); break;
    case 'tasks': unmountView = mountTasks(view); break;
    case 'docs': unmountView = mountNotes(view, route.params); break;
    case 'settings':
      unmountView = mountSettings(view, {
        onImported,
        onProjectDeleted: async () => {
          await store.refreshProjects();
          store.unloadProject();
          location.hash = '';
          onRoute();
        },
      });
      break;
    default:
      unmountView = mountArchitecture(view);
      unmountInspector = mountInspector(inspector, { navigate });
  }
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('h2', {}, 'No projects yet'),
    h('p', {}, 'Create a project to start mapping its architecture, or drop an ARCHON JSON file anywhere on this page to import one.'),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn primary', onClick: newProject }, icon('plus'), 'New project'),
      h('button', { class: 'btn', onClick: importJson }, icon('upload'), 'Import JSON')));
}

// ------------------------------------------------------------------ actions
async function newProject() {
  const name = h('input', { class: 'input', required: true, maxlength: 200, placeholder: 'Medieval Empire' });
  const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Optional description' });
  let created = null;
  await openModal({
    title: 'New project',
    initialFocus: name,
    body: h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Name'), name), h('div', { class: 'field' }, h('label', {}, 'Description'), desc)),
    actions: [{ label: 'Cancel' }, {
      label: 'Create', kind: 'primary', submit: true,
      onClick: async () => {
        try {
          created = await saver.track(store.createProject({ name: name.value, description: desc.value }));
        } catch (e) { toastError(e); return false; }
      },
    }],
  });
  if (created) {
    await store.refreshProjects();
    navigate('architecture', {}, created.id);
  }
}

function importJson() {
  pickAndImport(onImported);
}

async function onImported(project) {
  await store.refreshProjects();
  navigate('architecture', {}, project.id);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    await store.init();
  } catch (e) {
    $('main').append(h('div', { class: 'empty' }, h('h2', {}, 'Cannot reach the ARCHON server'), h('p', {}, e.message)));
    return;
  }
  store.on('projects', () => renderSidebar($('sidebar'), { view: route.view, navigate, newProject, importJson }));
  store.on('project', renderTopbar);
  for (const evt of ['modules', 'filter']) {
    store.on(evt, () => renderSidebar($('sidebar'), { view: route.view, navigate, newProject, importJson }));
  }
  // Object counts in the module tree; cheap enough to refresh on structural changes.
  store.on('graph', () => renderSidebar($('sidebar'), { view: route.view, navigate, newProject, importJson }));
  store.on('selection', () => syncSidebarSelection($('sidebar')));
  installDropZone(onImported);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('unhandledrejection', (e) => toastError(e.reason));
  await onRoute();
  if (store.projects.length === 0) toast('Tip: drop examples/medieval-empire.archon.json here to load a sample.');
}

boot();
