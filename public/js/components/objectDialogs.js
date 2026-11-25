import { h, options, human } from '../core/dom.js';
import { store } from '../core/store.js';
import { openModal, confirmDialog } from './modal.js';
import { objectPicker } from './picker.js';
import { toastError, toast } from './toast.js';

const moduleOptions = (selected) => [
  h('option', { value: '' }, '— none —'),
  ...store.modules.map((m) => h('option', { value: m.id, selected: m.id === selected }, m.name)),
];

/** Create an object (optionally as a child of parentId). Resolves with the new object or null. */
export async function addObjectDialog({ parentId = null, type } = {}) {
  const { meta } = store;
  const parent = parentId ? store.objects.get(parentId) : null;
  const allowed = parent ? meta.objectTypes : meta.objectTypes.filter((t) => !meta.memberTypes.includes(t));
  const typeSel = h('select', { class: 'input' }, options(allowed, type ?? (parent ? 'method' : 'class')));
  const name = h('input', { class: 'input mono', required: true, maxlength: 300, placeholder: parent ? 'do_something()' : 'ClassName' });
  const mod = h('select', { class: 'input', disabled: Boolean(parent) }, moduleOptions(parent?.module_id ?? store.moduleFilter));
  const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Optional description' });
  let created = null;

  await openModal({
    title: parent ? `Add member to ${parent.name}` : 'Add object',
    body: h('div', {},
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Type'), typeSel),
        h('div', { class: 'field' }, h('label', {}, 'Module'), mod)),
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Description'), desc),
      parent ? null : h('p', { class: 'hint' }, 'Methods, properties and signals are added from a class\'s inspector.')),
    initialFocus: name,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create', kind: 'primary', submit: true,
        onClick: async () => {
          try {
            created = await store.createObject({
              type: typeSel.value, name: name.value, description: desc.value,
              parent_id: parentId, module_id: parent ? undefined : mod.value || null,
            });
          } catch (e) {
            toastError(e);
            return false;
          }
        },
      },
    ],
  });
  return created;
}

/** Create a relationship. If targetId is omitted the user picks it. */
export async function relationshipDialog(sourceId, targetId = null) {
  const source = store.objects.get(sourceId);
  let target = targetId ? store.objects.get(targetId) : null;
  const typeSel = h('select', { class: 'input' }, options(store.meta.relationshipTypes, 'calls', human));
  const desc = h('input', { class: 'input', placeholder: 'Optional description' });
  const picker = target ? null : objectPicker({ onPick: (o) => { target = o; }, exclude: (o) => o.id === sourceId });
  let created = null;

  await openModal({
    title: 'New relationship',
    body: h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'From'), h('div', { class: 'mono' }, store.pathOf(sourceId), ' ', h('span', { class: 'type-tag' }, source.type))),
      h('div', { class: 'field' }, h('label', {}, 'Type'), typeSel),
      h('div', { class: 'field' }, h('label', {}, 'To'),
        picker ? picker.el : h('div', { class: 'mono' }, store.pathOf(target.id), ' ', h('span', { class: 'type-tag' }, target.type))),
      h('div', { class: 'field' }, h('label', {}, 'Description'), desc)),
    initialFocus: picker ? picker.input : typeSel,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create', kind: 'primary', submit: true,
        onClick: async () => {
          if (!target) { toast('Choose a target object.', 'error'); return false; }
          try {
            created = await store.createRelationship({
              source_id: sourceId, target_id: target.id, type: typeSel.value, description: desc.value,
            });
          } catch (e) {
            toastError(e);
            return false;
          }
        },
      },
    ],
  });
  return created;
}

/** Shows the relationship(s) behind a canvas edge, with edit and delete. */
export async function edgeDialog(relIds) {
  const rows = relIds.map((id) => store.relationships.get(id)).filter(Boolean);
  const body = h('ul', { class: 'row-list' }, rows.map((r) => {
    const desc = h('input', { class: 'input', value: r.description, placeholder: 'Description' });
    desc.addEventListener('change', () => store.updateRelationship(r.id, { description: desc.value }).catch(toastError));
    return h('li', { style: 'flex-direction:column;align-items:stretch;gap:6px;padding:8px 0' },
      h('div', { style: 'display:flex;gap:6px;align-items:center' },
        h('span', { class: 'badge accent plain' }, human(r.type)),
        h('span', { class: 'mono grow' }, `${store.pathOf(r.source_id)} → ${store.pathOf(r.target_id)}`),
        h('button', {
          class: 'btn sm danger',
          type: 'button',
          onClick: async (e) => {
            try {
              await store.removeRelationship(r.id);
              e.target.closest('li').remove();
            } catch (err) { toastError(err); }
          },
        }, 'Delete')),
      desc);
  }));
  await openModal({ title: rows.length > 1 ? `${rows.length} relationships` : 'Relationship', body, wide: true, actions: [{ label: 'Done', kind: 'primary' }] });
}

/** Delete with an impact preview. Resolves true if deleted. */
export async function deleteObjectFlow(id) {
  let impact;
  try {
    impact = await store.impact(id);
  } catch (e) {
    toastError(e);
    return false;
  }
  const items = [
    impact.children && `${impact.children} child object(s) will be deleted`,
    impact.relationships && `${impact.relationships} relationship(s) will be deleted`,
    impact.tasks && `${impact.tasks} task(s) will be unlinked (kept)`,
    impact.notes && `${impact.notes} note(s) will be unlinked (kept)`,
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: `Delete ${impact.object.type} "${impact.object.name}"?`,
    message: items.length ? 'This will also affect:' : 'Nothing else references this object.',
    extra: items.length ? h('ul', { class: 'impact-list' }, items.map((t) => h('li', {}, t))) : null,
  });
  if (!ok) return false;
  try {
    await store.removeObject(id);
    toast(`Deleted "${impact.object.name}".`, 'success');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

