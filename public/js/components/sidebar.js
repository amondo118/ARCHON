import { h, icon, iconButton, clear, append } from '../core/dom.js';
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
let ctx = null;
let sidebarTab = loadPref('tab') ?? 'modules';
const navigateTo = (view) => ctx.navigate(view);

function loadPref(key) {
  try { return localStorage.getItem(`archon.sidebar.${key}`); } catch { return null; }
}
function savePref(key, value) {
  try { localStorage.setItem(`archon.sidebar.${key}`, value); } catch { /* optional */ }
}

export function renderSidebar(el, context) {
  ctx = context;
  const { view, navigate, newProject, importJson } = context;
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

  // ---- Modules / Components tabs
  const prevScroll = el.dataset.scroll ? Number(el.dataset.scroll) : 0;
  const body = h('div', { class: 'sidebar-section grow', onScroll: (e) => { el.dataset.scroll = e.currentTarget.scrollTop; } });
  const tab = (id, label) => h('button', {
    class: `tab ${sidebarTab === id ? 'active' : ''}`, role: 'tab', 'aria-selected': String(sidebarTab === id),
    onClick: () => { sidebarTab = id; savePref('tab', id); el.dataset.scroll = 0; renderSidebar(el, ctx); },
  }, label);
  el.append(h('div', { class: 'tabs', role: 'tablist' }, tab('modules', 'Modules'), tab('components', 'Components')), body);
  if (sidebarTab === 'components') renderComponents(body, ctx);
  else renderModules(body);
  body.scrollTop = prevScroll;
}

// ------------------------------------------------------------------ modules tab
function renderModules(body) {
  const ownCount = new Map();
  for (const o of store.objects.values()) {
    if (!o.parent_id) ownCount.set(o.module_id, (ownCount.get(o.module_id) ?? 0) + 1);
  }
  const childrenOf = (id) => store.modules.filter((c) => c.parent_module_id === id);
  // Parent modules show their own objects plus everything in their sub-modules.
  const total = (m) => (ownCount.get(m.id) ?? 0) + childrenOf(m.id).reduce((a, c) => a + total(c), 0);

  const item = (m, depth) => {
    const own = ownCount.get(m.id) ?? 0;
    const all = total(m);
    return h('div', {},
      h('div', {
        class: `tree-item ${store.moduleFilter === m.id ? 'active' : ''}`,
        style: `padding-left:${8 + depth * 14}px`,
        role: 'button', tabindex: 0,
        title: 'Show only this module (and its sub-modules) on the canvas',
        onClick: () => { store.setModuleFilter(m.id); navigateTo('architecture'); },
        onKeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
      },
      h('span', { class: 'swatch', style: m.color ? `background:${m.color}` : '' }),
      h('span', { class: 'label' }, m.name),
      h('span', { class: 'count', title: all !== own ? `${own} directly, ${all} including sub-modules` : `${all} objects` }, all),
      h('button', {
        class: 'btn ghost sm icon-only edit', title: 'Edit module',
        onClick: (e) => { e.stopPropagation(); moduleDialog(m); },
      }, icon('pencil', 'sm'))),
      childrenOf(m.id).map((c) => item(c, depth + 1)));
  };

  const unassigned = ownCount.get(null) ?? 0;
  append(body,
    h('div', { class: 'sidebar-heading' }, 'Filter canvas by module', iconButton('plus', 'New module', () => moduleDialog(null), 'ghost sm')),
    h('div', {
      class: `tree-item ${store.moduleFilter ? '' : 'active'}`, role: 'button', tabindex: 0,
      onClick: () => { store.setModuleFilter(null); navigateTo('architecture'); },
    }, icon('boxes', 'sm'), h('span', { class: 'label' }, 'All objects'),
    h('span', { class: 'count' }, [...store.objects.values()].filter((o) => !o.parent_id).length)),
    childrenOf(null).map((m) => item(m, 0)),
    unassigned && store.modules.length ? h('p', { class: 'hint', style: 'padding:4px 8px' }, `${unassigned} object(s) not in a module`) : null,
    store.modules.length ? null : h('p', { class: 'hint', style: 'padding:4px 8px' }, 'Modules group objects into systems (e.g. Units, World).'));
}

// ------------------------------------------------------------------ components tab
const expanded = new Set();
let query = '';
let rangeAnchor = null;

function renderComponents(body) {
  const list = h('div', { class: 'comp-list', role: 'tree', 'aria-multiselectable': 'true' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Filter components…', value: query });
  search.addEventListener('input', () => { query = search.value; renderList(); });
  const filterName = store.moduleFilter ? store.moduleName(store.moduleFilter) : null;
  append(body,
    h('div', { style: 'padding:0 4px 8px' }, search),
    filterName ? h('div', { class: 'hint', style: 'padding:0 8px 6px;display:flex;gap:6px;align-items:center' },
      `Module: ${filterName}`, h('button', { class: 'link', onClick: () => store.setModuleFilter(null) }, 'show all')) : null,
    list,
    h('p', { class: 'hint', style: 'padding:8px' }, 'Click to select · Ctrl/Cmd-click to add · Shift-click for a range'));

  function renderList() {
    clear(list);
    const q = query.trim().toLowerCase();
    const kids = (id) => [...store.objects.values()].filter((o) => o.parent_id === id)
      .sort((a, b) => (id ? a.sort_order - b.sort_order : a.name.localeCompare(b.name)));
    const inScope = moduleScope();
    // With a query, keep matches and their ancestors (so context stays visible).
    const matches = (o) => o.name.toLowerCase().includes(q) || kids(o.id).some(matches);
    const rows = [];
    const walk = (o, depth) => {
      if (q && !matches(o)) return;
      const children = kids(o.id);
      const open = q ? true : expanded.has(o.id);
      rows.push(o.id);
      list.append(h('div', {
        class: `tree-item comp ${store.selection.has(o.id) ? 'selected' : ''}`,
        style: `padding-left:${4 + depth * 14}px`,
        role: 'treeitem', tabindex: -1, 'aria-selected': String(store.selection.has(o.id)),
        dataset: { obj: o.id },
        onClick: (e) => onRowClick(e, o.id, rows),
      },
      children.length
        ? h('button', {
          class: 'caret', 'aria-label': open ? 'Collapse' : 'Expand',
          onClick: (e) => { e.stopPropagation(); if (open) expanded.delete(o.id); else expanded.add(o.id); renderList(); },
        }, icon(open ? 'chevron-down' : 'chevron-right', 'sm'))
        : h('span', { class: 'caret' }),
      h('span', { class: `dot ${o.health_status}`, title: o.health_status }),
      h('span', { class: 'label mono' }, o.name),
      h('span', { class: 'type-tag' }, o.type)));
      if (open) children.forEach((c) => walk(c, depth + 1));
    };
    kids(null).filter((o) => !inScope || inScope.has(o.module_id)).forEach((o) => walk(o, 0));
    if (!rows.length) list.append(h('p', { class: 'hint', style: 'padding:4px 8px' }, q ? 'No matches.' : 'No objects yet.'));
  }
  renderList();
}

function onRowClick(e, id, rows) {
  if (e.shiftKey && rangeAnchor && rows.includes(rangeAnchor)) {
    const [a, b] = [rows.indexOf(rangeAnchor), rows.indexOf(id)].sort((x, y) => x - y);
    const range = rows.slice(a, b + 1);
    const base = e.ctrlKey || e.metaKey ? [...store.selection] : [];
    store.setSelection([...base, ...range], id);
  } else if (e.ctrlKey || e.metaKey) {
    store.toggleSelected(id);
    rangeAnchor = id;
  } else {
    rangeAnchor = id;
    store.select(id);
    store.focus(id);
  }
  if (ctx.view !== 'architecture') navigateTo('architecture');
}

/** Update row highlighting in place when the selection changes elsewhere (e.g. the canvas). */
export function syncSidebarSelection(el) {
  let first = null;
  el.querySelectorAll('.comp[data-obj]').forEach((row) => {
    const on = store.selection.has(row.dataset.obj);
    row.classList.toggle('selected', on);
    row.setAttribute('aria-selected', String(on));
    if (on && !first) first = row;
  });
  first?.scrollIntoView({ block: 'nearest' });
}

function moduleScope() {
  if (!store.moduleFilter) return null;
  const ids = new Set([store.moduleFilter]);
  for (let grew = true; grew;) {
    grew = false;
    for (const m of store.modules) {
      if (m.parent_module_id && ids.has(m.parent_module_id) && !ids.has(m.id)) { ids.add(m.id); grew = true; }
    }
  }
  return ids;
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
