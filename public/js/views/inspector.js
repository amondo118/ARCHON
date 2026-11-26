import { h, icon, iconButton, options, human, statusBadge, clear } from '../core/dom.js';
import { store } from '../core/store.js';
import { api } from '../api/client.js';
import { saver } from '../core/saver.js';
import { addObjectDialog, relationshipDialog, deleteObjectFlow } from '../components/objectDialogs.js';
import { toastError } from '../components/toast.js';

/**
 * Right-hand panel: full editable details of the selected object, including
 * children, relationships (incoming/outgoing/inheritance), tasks and notes.
 * Fields save on change (blur / select), not on every keystroke.
 */
export function mountInspector(container, { navigate }) {
  let relFilter = '';
  let loadToken = 0;

  async function render() {
    const id = store.selectedId;
    const token = ++loadToken;
    if (store.selection.size > 1) {
      clear(container).append(...buildMulti());
      return;
    }
    if (!id || !store.objects.has(id)) {
      clear(container).append(h('div', { class: 'insp-empty' },
        store.projectId ? 'Select an object on the canvas to inspect it.' : 'No project selected.'));
      return;
    }
    let details;
    try {
      details = await api.objects.details(id);
    } catch (e) {
      if (token === loadToken) toastError(e);
      return;
    }
    if (token !== loadToken) return; // a newer selection won the race
    // Re-rendering after a save must not steal focus from the field the user moved to.
    const scrollTop = container.scrollTop;
    const focusKey = container.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    clear(container).append(...build(details));
    container.scrollTop = scrollTop;
    if (focusKey) container.querySelector(`[data-key="${focusKey}"]`)?.focus();
  }

  function save(id, patch) {
    store.updateObject(id, patch).catch((e) => { toastError(e); render(); });
  }

  function build({ object: o, children, incoming, outgoing, tasks, notes }) {
    const meta = store.meta;
    const parent = o.parent_id ? store.objects.get(o.parent_id) : null;

    const input = (field, attrs = {}) => {
      const el = h(attrs.multiline ? 'textarea' : 'input', { class: `input ${attrs.mono ? 'mono' : ''}`, dataset: { key: field }, value: o[field] ?? '', rows: 4, placeholder: attrs.placeholder ?? '' });
      el.addEventListener('change', () => {
        if (attrs.required && !el.value.trim()) { el.value = o[field]; return; }
        save(o.id, { [field]: el.value === '' && attrs.nullable ? null : el.value });
      });
      return el;
    };
    const select = (field, values, labelFn = human) => {
      const el = h('select', { class: 'input', dataset: { key: field } }, options(values, o[field], labelFn));
      el.addEventListener('change', () => save(o.id, { [field]: el.value }));
      return el;
    };
    const segmented = (field, values) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': human(field) },
      values.map((v) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(o[field] === v),
        class: o[field] === v ? 'on' : '', style: `--sel:var(--${v}, var(--accent))`,
        onClick: () => save(o.id, { [field]: v }),
      }, human(v))));

    const moduleSel = h('select', { class: 'input', dataset: { key: 'module_id' }, disabled: Boolean(parent), title: parent ? 'Children use their parent\'s module' : '' },
      h('option', { value: '' }, '— none —'),
      store.modules.map((m) => h('option', { value: m.id, selected: m.id === o.module_id }, m.name)));
    moduleSel.addEventListener('change', () => save(o.id, { module_id: moduleSel.value || null }));

    const promoted = store.isPromoted(o.id);
    const head = h('div', { class: 'insp-head' },
      h('div', { class: 'crumb' }, parent
        ? h('button', { class: 'link', onClick: () => store.focus(parent.id) }, store.pathOf(parent.id))
        : (store.moduleName(o.module_id) ?? 'No module')),
      h('div', { class: 'name' }, o.name),
      h('div', { class: 'meta' }, h('span', { class: 'badge accent plain' }, o.type), statusBadge(o.health_status),
        h('span', { class: 'badge plain' }, human(o.implementation_status)),
        h('span', { style: 'flex:1' }),
        parent ? h('button', { class: 'btn sm', onClick: () => (promoted ? store.unpromote(o.id) : store.promote(o.id)) },
          promoted ? 'Return to card' : 'Show on canvas') : null,
        iconButton('trash-2', 'Delete object', () => deleteObjectFlow(o.id), 'ghost sm danger')));

    const general = section('General',
      h('div', { class: 'field' }, h('label', {}, 'Name'), input('name', { mono: true, required: true })),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Type'), select('type', meta.objectTypes, (v) => v)),
        h('div', { class: 'field' }, h('label', {}, 'Module'), moduleSel)),
      h('div', { class: 'field' }, h('label', {}, 'Health'), segmented('health_status', meta.healthStatuses)),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Implementation'), select('implementation_status', meta.implementationStatuses)),
        h('div', { class: 'field' }, h('label', {}, 'Visibility'), select('visibility', meta.visibilities))),
      h('div', { class: 'field' }, h('label', {}, 'Source file'), input('file_path', { mono: true, nullable: true, placeholder: 'scripts/units/villager.gd' })),
      h('div', { class: 'field' }, h('label', {}, 'Description'), input('description', { multiline: true })));

    // ---- children
    const isContainer = meta.containerTypes.includes(o.type);
    const childSection = isContainer ? section(`Members (${children.length})`,
      h('ul', { class: 'row-list' }, children.map((c) => h('li', {},
        h('span', { class: 'type-tag' }, c.type.slice(0, 4)),
        h('button', { class: 'link grow mono', onClick: () => store.focus(c.id) }, c.name),
        statusBadge(c.health_status),
        h('span', { class: 'actions' },
          store.isPromoted(c.id)
            ? iconButton('minimize-2', 'Return to card', () => store.unpromote(c.id), 'ghost sm')
            : iconButton('arrow-up-right', 'Show as separate canvas node', () => store.promote(c.id), 'ghost sm'),
          iconButton('trash-2', 'Delete', () => deleteObjectFlow(c.id), 'ghost sm'))))),
      quickAddChild(o)) : null;

    // ---- relationships
    const rels = [...outgoing.map((r) => ({ r, dir: 'out', other: r.target_id })), ...incoming.map((r) => ({ r, dir: 'in', other: r.source_id }))]
      .filter(({ r }) => !relFilter || r.type === relFilter);
    const relFilterSel = h('select', { class: 'input', style: 'width:auto;min-height:24px;padding:2px 4px;font-size:11px' },
      h('option', { value: '' }, 'all types'), options(meta.relationshipTypes, relFilter, human));
    relFilterSel.addEventListener('change', () => { relFilter = relFilterSel.value; render(); });
    const relRow = ({ r, dir, other }) => h('li', {},
      h('span', { class: 'muted', title: dir === 'out' ? 'outgoing' : 'incoming' }, dir === 'out' ? '→' : '←'),
      h('span', { class: 'type-tag' }, human(r.type)),
      h('button', { class: 'link grow mono', title: r.description || '', onClick: () => store.focus(other) }, store.pathOf(other)),
      h('span', { class: 'actions' }, iconButton('trash-2', 'Delete relationship', () => store.removeRelationship(r.id).catch(toastError), 'ghost sm')));
    const outRows = rels.filter((x) => x.dir === 'out');
    const inRows = rels.filter((x) => x.dir === 'in');
    const relSection = section(h('span', {}, `Relationships (${outgoing.length + incoming.length})`), [
      h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' }, relFilterSel, h('span', { style: 'flex:1' }),
        h('button', { class: 'btn sm', onClick: () => relationshipDialog(o.id) }, icon('plus', 'sm'), 'Add')),
      h('div', { class: 'label-sm', style: 'margin:6px 0 2px' }, `Outgoing (${outRows.length})`),
      outRows.length ? h('ul', { class: 'row-list' }, outRows.map(relRow)) : h('div', { class: 'hint' }, 'None'),
      h('div', { class: 'label-sm', style: 'margin:10px 0 2px' }, `Incoming (${inRows.length})`),
      inRows.length ? h('ul', { class: 'row-list' }, inRows.map(relRow)) : h('div', { class: 'hint' }, 'None'),
      inheritance(o.id),
    ]);

    // ---- tasks + notes
    const taskSection = section(`Tasks (${tasks.length})`,
      h('ul', { class: 'row-list' }, tasks.map((t) => h('li', {},
        h('span', { class: `badge plain ${t.status === 'done' ? 'good' : ''}` }, human(t.status)),
        h('button', { class: 'link grow', onClick: () => navigate('tasks') }, t.title)))),
      quickAddTask(o));
    const noteSection = section(`Notes (${notes.length})`,
      h('ul', { class: 'row-list' }, notes.map((n) => h('li', {},
        h('span', { class: 'type-tag' }, n.type),
        h('button', { class: 'link grow', onClick: () => navigate('docs', { note: n.id }) }, n.title)))),
      h('button', { class: 'btn sm', style: 'margin-top:6px', onClick: () => navigate('docs', { newFor: o.id }) }, icon('plus', 'sm'), 'New note'));

    return [head, general, childSection, relSection, taskSection, noteSection].filter(Boolean);
  }

  /** Several objects selected: list them and offer bulk status changes. */
  function buildMulti() {
    const ids = [...store.selection];
    const objs = ids.map((x) => store.objects.get(x)).filter(Boolean);
    const bulk = async (patch) => {
      try {
        for (const o of objs) await store.updateObject(o.id, patch);
      } catch (e) { toastError(e); }
    };
    const seg = (field, values) => h('div', { class: 'segmented' }, values.map((v) => h('button', {
      type: 'button',
      class: objs.every((o) => o[field] === v) ? 'on' : '',
      style: `--sel:var(--${v}, var(--accent))`,
      onClick: () => bulk({ [field]: v }),
    }, human(v))));
    return [
      h('div', { class: 'insp-head' }, h('div', { class: 'name' }, `${objs.length} objects selected`),
        h('div', { class: 'hint' }, 'Drag any of them on the canvas to move them together. Ctrl/Cmd-click to add or remove.')),
      section('Set for all',
        h('div', { class: 'field' }, h('label', {}, 'Health'), seg('health_status', store.meta.healthStatuses)),
        h('div', { class: 'field' }, h('label', {}, 'Implementation'), seg('implementation_status', store.meta.implementationStatuses))),
      section('Selection', h('ul', { class: 'row-list' }, objs.map((o) => h('li', {},
        h('span', { class: 'type-tag' }, o.type.slice(0, 4)),
        h('button', { class: 'link grow mono', onClick: () => store.focus(o.id) }, store.pathOf(o.id)),
        statusBadge(o.health_status),
        h('span', { class: 'actions' }, iconButton('x', 'Remove from selection', () => store.toggleSelected(o.id), 'ghost sm')))))),
    ];
  }

  function quickAddChild(o) {
    const typeSel = h('select', { class: 'input' }, options(store.meta.objectTypes, 'method'));
    const name = h('input', { class: 'input mono', dataset: { key: 'quick-child' }, placeholder: 'name, Enter to add' });
    const add = async () => {
      if (!name.value.trim()) return;
      try {
        await store.createObject({ type: typeSel.value, name: name.value, parent_id: o.id });
        name.value = ''; // the graph event re-renders and restores focus via data-key
      } catch (e) { toastError(e); }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'inline-add' }, typeSel, name, iconButton('plus', 'Add member', add, ''));
  }

  function quickAddTask(o) {
    const title = h('input', { class: 'input', dataset: { key: 'quick-task' }, placeholder: 'New task, Enter to add' });
    title.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !title.value.trim()) return;
      e.preventDefault();
      try {
        await saver.track(api.tasks.create(store.projectId, { title: title.value, status: 'todo', linked_object_id: o.id }));
        await render();
        container.querySelector('[data-key="quick-task"]')?.focus();
      } catch (err) { toastError(err); }
    });
    return h('div', { class: 'inline-add' }, title);
  }

  function inheritance(id) {
    const rels = [...store.relationships.values()].filter((r) => r.type === 'inherits');
    const chain = [];
    const seen = new Set([id]);
    for (let cur = id; ;) {
      const up = rels.find((r) => r.source_id === cur);
      if (!up || seen.has(up.target_id)) break;
      chain.push(up.target_id);
      seen.add(up.target_id);
      cur = up.target_id;
    }
    const children = rels.filter((r) => r.target_id === id).map((r) => r.source_id);
    if (!chain.length && !children.length) return null;
    const link = (oid) => h('button', { class: 'link mono', onClick: () => store.focus(oid) }, store.objects.get(oid)?.name);
    return h('div', { style: 'margin-top:10px' },
      h('div', { class: 'label-sm' }, 'Inheritance'),
      chain.length ? h('div', { class: 'chain' }, store.objects.get(id).name, chain.map((c) => [' → ', link(c)])) : null,
      children.length ? h('div', { class: 'chain' }, 'Inherited by: ', children.map((c, i) => [i ? ', ' : '', link(c)])) : null);
  }

  const offs = [
    store.on('selection', render),
    store.on('graph', render),
  ];
  render();
  return () => offs.forEach((off) => off());
}

function section(title, ...content) {
  return h('div', { class: 'insp-section' }, h('div', { class: 'label-sm' }, title), content);
}
