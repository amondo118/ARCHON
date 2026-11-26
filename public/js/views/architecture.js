import { h, icon, iconButton, human, debounce } from '../core/dom.js';
import { store } from '../core/store.js';
import { createCanvas } from '../canvas/canvas.js';
import { addObjectDialog, relationshipDialog, edgeDialog, deleteObjectFlow } from '../components/objectDialogs.js';

/** Module ids for the active sidebar filter (module + its sub-modules). */
function filterModuleIds() {
  if (!store.moduleFilter) return null;
  const ids = new Set([store.moduleFilter]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of store.modules) {
      if (m.parent_module_id && ids.has(m.parent_module_id) && !ids.has(m.id)) { ids.add(m.id); grew = true; }
    }
  }
  return ids;
}

export function mountArchitecture(container) {
  const hiddenRelTypes = new Set();
  const cyEl = h('div', { class: 'cy' });
  const hint = h('div', { class: 'canvas-hint', hidden: true });
  const wrap = h('div', { class: 'canvas-wrap' }, cyEl, hint, legend());
  let menu = null;

  const connectBtn = h('button', { class: 'btn', title: 'Connect objects (C)', onClick: () => toggleConnect() }, icon('cable'), 'Connect');
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search…  (/)', 'aria-label': 'Search objects' });
  const filterBtn = h('button', { class: 'btn', title: 'Filter relationship types', onClick: () => toggleFilterPop() }, icon('eye'), 'Relations');
  const filterPop = h('div', { class: 'filter-pop', hidden: true },
    store.meta.relationshipTypes.map((t) => {
      const cb = h('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => {
        if (cb.checked) hiddenRelTypes.delete(t); else hiddenRelTypes.add(t);
        filterBtn.classList.toggle('active', hiddenRelTypes.size > 0);
        canvas.sync();
      });
      return h('label', {}, cb, human(t));
    }));

  const toolbar = h('div', { class: 'canvas-toolbar' },
    h('button', { class: 'btn primary', onClick: () => addObjectDialog().then((o) => o && store.select(o.id)) }, icon('plus'), 'Add object'),
    connectBtn,
    search,
    h('div', { style: 'position:relative' }, filterBtn, filterPop),
    h('button', { class: 'btn', title: 'Arrange automatically', onClick: () => canvas.autoLayout() }, icon('workflow'), 'Auto layout'),
    iconButton('unfold-vertical', 'Expand all', () => setAllCollapsed(false)),
    iconButton('fold-vertical', 'Collapse all', () => setAllCollapsed(true)),
    h('span', { style: 'flex:1' }),
    iconButton('zoom-out', 'Zoom out', () => canvas.zoomBy(0.8)),
    iconButton('zoom-in', 'Zoom in', () => canvas.zoomBy(1.25)),
    iconButton('maximize', 'Fit to screen', () => canvas.fit()));

  container.append(toolbar, wrap);

  const canvas = createCanvas(cyEl, {
    relationshipTypes: store.meta.relationshipTypes,
    getData: () => ({
      objects: store.objects,
      relationships: store.relationships,
      positions: store.positions,
      moduleIds: filterModuleIds(),
      hiddenRelTypes,
    }),
    onSelectionChange: (ids, primary) => store.setSelection(ids, primary),
    onEdgeTap: (relIds) => edgeDialog(relIds),
    onConnect: (s, t) => relationshipDialog(s, t),
    onMove: (entries) => store.setPositions(entries),
    onAutoPlace: (entries) => store.setPositions(entries),
    onToggleCollapse: (id) => {
      if (store.childrenOf(id).length) store.setCollapsed(id, !store.positions.get(id)?.collapsed);
    },
    onContextMenu: (objId, pos, rootId) => openMenu(objId, rootId, pos),
  });

  function setAllCollapsed(collapsed) {
    const entries = [...store.positions.keys()].filter((id) => store.childrenOf(id).length).map((id) => [id, { collapsed }]);
    store.setPositions(entries);
    canvas.sync();
  }

  // ---- connect mode
  function toggleConnect(force) {
    const on = force ?? !connectBtn.classList.contains('active');
    canvas.setConnectMode(on, (active, from) => {
      connectBtn.classList.toggle('active', active);
      hint.hidden = !active;
      hint.textContent = from
        ? `Connecting from ${store.pathOf(from)} — click the target (Esc to cancel)`
        : 'Click the source object (Esc to cancel)';
    });
  }

  // ---- search
  const runSearch = debounce(() => {
    const q = search.value.trim().toLowerCase();
    canvas.highlight(q ? (id) => store.objects.get(id)?.name.toLowerCase().includes(q) : null);
  }, 150);
  search.addEventListener('input', runSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    const hit = [...store.objects.values()].find((o) => o.name.toLowerCase().includes(q));
    if (hit) {
      store.select(hit.id);
      canvas.focus(hit.id);
    }
  });

  function toggleFilterPop() {
    filterPop.hidden = !filterPop.hidden;
  }

  // ---- context menu
  function closeMenu() {
    menu?.remove();
    menu = null;
  }
  function openMenu(objId, rootId, pos) {
    closeMenu();
    const o = store.objects.get(objId);
    if (!o) return;
    if (!store.selection.has(objId)) store.select(objId);
    const isContainer = store.meta.containerTypes.includes(o.type);
    const hasKids = store.childrenOf(rootId).length > 0;
    const collapsed = store.positions.get(rootId)?.collapsed;
    const item = (label, ic, fn) => h('button', { class: 'nav-item', onClick: () => { closeMenu(); fn(); } }, icon(ic, 'sm'), label);
    menu = h('div', { class: 'filter-pop', style: `left:${pos.x}px;top:${pos.y}px;padding:4px`, role: 'menu' },
      item('Connect from here', 'cable', () => { toggleConnect(true); canvas.startConnectFrom(objId); }),
      isContainer && item('Add member', 'plus', () => addObjectDialog({ parentId: objId })),
      o.parent_id && !store.isPromoted(objId) && item('Show as separate node', 'arrow-up-right', () => store.promote(objId)),
      store.isPromoted(objId) && item('Return to parent card', 'minimize-2', () => store.unpromote(objId)),
      hasKids && objId === rootId && item(collapsed ? 'Expand' : 'Collapse', collapsed ? 'unfold-vertical' : 'fold-vertical',
        () => store.setCollapsed(rootId, !collapsed)),
      item('Delete…', 'trash-2', () => deleteObjectFlow(objId)));
    wrap.append(menu);
  }
  const onDocClick = (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
    if (!filterPop.hidden && !filterPop.parentElement.contains(e.target)) filterPop.hidden = true;
  };
  document.addEventListener('mousedown', onDocClick);

  // ---- keyboard
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const onKey = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === 'Escape') { canvas.cancelConnect(); closeMenu(); }
    if (typing(e)) return;
    if (e.key === 'c' || e.key === 'C') toggleConnect();
    else if (e.key === '/') { e.preventDefault(); search.focus(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.size === 1) deleteObjectFlow(store.selectedId);
    else if (e.key === 'Escape') store.select(null);
    else if (e.key === 'f') canvas.fit();
  };
  document.addEventListener('keydown', onKey);

  // ---- store subscriptions
  const offs = [
    store.on('graph', () => { canvas.sync(); canvas.select(store.selection); }),
    store.on('filter', () => canvas.sync()),
    store.on('selection', () => canvas.select(store.selection)),
    store.on('focus', (id) => canvas.focus(id)),
  ];

  canvas.sync();
  canvas.select(store.selection);
  requestAnimationFrame(() => {
    canvas.cy.resize();
    if (store.selectedId) canvas.focus(store.selectedId); else canvas.fit();
  });

  return () => {
    offs.forEach((off) => off());
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onDocClick);
    canvas.destroy();
  };
}

function legend() {
  return h('div', { class: 'canvas-legend' },
    store.meta.relationshipTypes.map((t) => h('span', {}, h('i', { style: `background:var(--rel-${t})` }), human(t))),
    h('span', {}, '· dashed border = planned · Shift/Ctrl-click or Shift-drag to multi-select · right-click for actions · double-click to collapse'));
}
