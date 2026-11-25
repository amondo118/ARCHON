import { h, icon, iconButton, clear } from '../core/dom.js';
import { store } from '../core/store.js';
import { openModal, confirmDialog } from './modal.js';
import { toastError } from './toast.js';

export const NAV = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'architecture', label: 'Architecture', icon: 'network' },
  { id: 'tasks', label: 'Tasks', icon: 'list-todo' },
  { id: 'docs', label: 'Documentation', icon: 'book-open' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** Left sidebar: project switcher, navigation and module tree. */
export function renderSidebar(el, { view, navigate, newProject, importJson }) {
  clear(el);
  el.append(h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'ARCHON'));

  const projectSel = h('select', { class: 'input', 'aria-label': 'Project' },
    store.projects.length ? null : h('option', { value: '' }, 'No projects'),
    store.projects.map((p) => h('option', { value: p.id, selected: p.id === store.projectId }, p.name)));
  projectSel.addEventListener('change', () => navigate(view, {}, projectSel.value));
  el.append(h('div', { class: 'sidebar-section' },
    h('div', { class: 'sidebar-heading' }, 'Project',
      h('span', { class: 'btn-group' },
        iconButton('upload', 'Import JSON', importJson, 'ghost sm'),
        iconButton('plus', 'New project', newProject, 'ghost sm'))),
    projectSel));

  if (!store.projectId) return;

  el.append(h('nav', { class: 'sidebar-section' }, NAV.map((n) => h('button', {
    class: `nav-item ${view === n.id ? 'active' : ''}`,
    'aria-current': view === n.id ? 'page' : null,
    onClick: () => navigate(n.id),
  }, icon(n.icon), n.label))));

  // ---- module tree
  const topLevelCount = new Map();
  for (const o of store.objects.values()) {
    if (!o.parent_id) topLevelCount.set(o.module_id, (topLevelCount.get(o.module_id) ?? 0) + 1);
  }
  const tree = h('div');
  const item = (m, depth) => h('div', {},
    h('div', {
      class: `tree-item ${store.moduleFilter === m.id ? 'active' : ''}`,
      style: `padding-left:${8 + depth * 14}px`,
      role: 'button', tabindex: 0,
      title: 'Show only this module on the canvas',
      onClick: () => { store.setModuleFilter(m.id); navigate('architecture'); },
      onKeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
    },
    h('span', { class: 'swatch', style: m.color ? `background:${m.color}` : '' }),
    h('span', { class: 'label' }, m.name),
    h('span', { class: 'count' }, topLevelCount.get(m.id) ?? 0),
    h('button', {
      class: 'btn ghost sm icon-only edit', title: 'Edit module',
      onClick: (e) => { e.stopPropagation(); moduleDialog(m); },
    }, icon('pencil', 'sm'))),
    store.modules.filter((c) => c.parent_module_id === m.id).map((c) => item(c, depth + 1)));

  tree.append(h('div', {
    class: `tree-item ${store.moduleFilter ? '' : 'active'}`, role: 'button', tabindex: 0,
    onClick: () => { store.setModuleFilter(null); navigate('architecture'); },
  }, icon('boxes', 'sm'), h('span', { class: 'label' }, 'All objects'), h('span', { class: 'count' }, store.objects.size)));
  store.modules.filter((m) => !m.parent_module_id).forEach((m) => tree.append(item(m, 0)));
  if (!store.modules.length) tree.append(h('p', { class: 'hint', style: 'padding:4px 8px' }, 'Modules group objects into systems (e.g. Units, World).'));

  el.append(h('div', { class: 'sidebar-section grow' },
    h('div', { class: 'sidebar-heading' }, 'Modules', iconButton('plus', 'New module', () => moduleDialog(null), 'ghost sm')),
    tree));
}

const PALETTE = ['#55A9E8', '#9B8BEA', '#4BC58A', '#E8AD53', '#E46D78', '#4BC5B5', '#8996A7'];

export async function moduleDialog(mod) {
  const name = h('input', { class: 'input', value: mod?.name ?? '', required: true, maxlength: 200 });
  const color = h('select', { class: 'input' }, h('option', { value: '' }, 'none'),
    PALETTE.map((c) => h('option', { value: c, selected: mod?.color?.toUpperCase() === c, style: `color:${c}` }, `■ ${c}`)));
  const descendants = (id) => store.modules.filter((m) => m.parent_module_id === id).flatMap((m) => [m.id, ...descendants(m.id)]);
  const blocked = mod ? new Set([mod.id, ...descendants(mod.id)]) : new Set();
  const parent = h('select', { class: 'input' }, h('option', { value: '' }, '— top level —'),
    store.modules.filter((m) => !blocked.has(m.id)).map((m) => h('option', { value: m.id, selected: m.id === mod?.parent_module_id }, m.name)));
  const desc = h('textarea', { class: 'input', rows: 2 }, mod?.description ?? '');

  const actions = [{ label: 'Cancel' }, {
    label: mod ? 'Save' : 'Create', kind: 'primary', submit: true,
    onClick: async () => {
      const body = { name: name.value, color: color.value || null, parent_module_id: parent.value || null, description: desc.value };
      try {
        if (mod) await store.updateModule(mod.id, body);
        else await store.createModule(body);
      } catch (e) { toastError(e); return false; }
    },
  }];
  if (mod) {
    actions.unshift({
      label: 'Delete', kind: 'danger',
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Delete module "${mod.name}"?`,
          message: 'Objects in this module are kept (they become unassigned) and sub-modules move up one level.',
        });
        if (!ok) return false;
        try { await store.removeModule(mod.id); } catch (e) { toastError(e); return false; }
      },
    });
  }
  await openModal({
    title: mod ? 'Edit module' : 'New module',
    initialFocus: name,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Parent module'), parent),
        h('div', { class: 'field' }, h('label', {}, 'Color'), color)),
      h('div', { class: 'field' }, h('label', {}, 'Description'), desc)),
    actions,
  });
}
