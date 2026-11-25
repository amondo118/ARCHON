import { marked } from '/vendor/marked/marked.esm.js';
import DOMPurify from '/vendor/dompurify/purify.es.mjs';
import { h, icon, options, human, clear } from '../core/dom.js';
import { store } from '../core/store.js';
import { api } from '../api/client.js';
import { saver } from '../core/saver.js';
import { confirmDialog } from '../components/modal.js';
import { objectPicker } from '../components/picker.js';
import { toastError } from '../components/toast.js';

export const renderMarkdown = (md) => DOMPurify.sanitize(marked.parse(md ?? ''));

/** Documentation: notes and decision records, optionally linked to objects. */
export function mountNotes(container, params = {}) {
  let notes = [];
  let activeId = params.note ?? null;
  let typeFilter = '';
  const listBody = h('div');
  const editor = h('div', { class: 'note-editor' });

  const typeSel = h('select', { class: 'input' }, h('option', { value: '' }, 'All types'), options(store.meta.noteTypes, '', human));
  typeSel.addEventListener('change', () => { typeFilter = typeSel.value; renderList(); });

  container.classList.add('flush');
  container.append(h('div', { class: 'notes' },
    h('div', { class: 'notes-list' },
      h('div', { class: 'bar-top' }, h('button', { class: 'btn primary', onClick: () => create() }, icon('plus'), 'New'), typeSel),
      listBody),
    editor));

  async function load() {
    try {
      notes = await api.notes.list(store.projectId);
      if (params.newFor) return create(params.newFor);
      activeId ??= sorted()[0]?.id ?? null;
      renderList();
      renderEditor();
    } catch (e) { toastError(e); }
  }

  const sorted = () => [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  function renderList() {
    clear(listBody);
    const items = sorted().filter((n) => !typeFilter || n.type === typeFilter);
    if (!items.length) listBody.append(h('p', { class: 'hint', style: 'padding:14px' }, 'No notes yet.'));
    for (const n of items) {
      listBody.append(h('button', { class: `note-item ${n.id === activeId ? 'active' : ''}`, onClick: () => { activeId = n.id; renderList(); renderEditor(); } },
        h('div', {}, n.title),
        h('div', { class: 'sub' }, h('span', { class: 'type-tag' }, n.type),
          n.linked_object_id ? h('span', { class: 'mono' }, store.pathOf(n.linked_object_id)) : null)));
    }
  }

  function renderEditor() {
    clear(editor);
    const n = notes.find((x) => x.id === activeId);
    if (!n) {
      editor.append(h('div', { class: 'empty' }, h('h2', {}, 'Documentation'),
        h('p', {}, 'Record design decisions, technical notes and known problems. Notes can be linked to architecture objects.')));
      return;
    }
    const patch = (body) => saver.track(api.notes.update(n.id, body))
      .then((u) => { Object.assign(n, u); renderList(); })
      .catch(toastError);

    const title = h('input', { class: 'input', value: n.title, style: 'font-size:16px;font-weight:600' });
    title.addEventListener('change', () => { if (title.value.trim()) patch({ title: title.value }); });
    const type = h('select', { class: 'input', style: 'width:auto' }, options(store.meta.noteTypes, n.type, human));
    type.addEventListener('change', () => patch({ type: type.value }));
    const picker = objectPicker({
      placeholder: 'Link to object (optional)', initial: n.linked_object_id,
      onPick: (o) => patch({ linked_object_id: o.id }),
    });
    picker.input.addEventListener('change', () => { if (!picker.input.value.trim() && n.linked_object_id) patch({ linked_object_id: null }); });

    const content = h('textarea', { class: 'input mono' }, n.content);
    // Debounced autosave while typing; flushed on blur and before navigation.
    content.addEventListener('input', () => saver.schedule(`note:${n.id}`, () => api.notes.update(n.id, { content: content.value }).then((u) => Object.assign(n, u)), 1200));
    content.addEventListener('blur', () => saver.flush());
    const preview = h('div', { class: 'markdown', hidden: true });
    const toggle = h('button', { class: 'btn', onClick: () => {
      const showing = !preview.hidden;
      preview.hidden = showing;
      content.hidden = !showing;
      toggle.textContent = showing ? 'Preview' : 'Edit';
      if (!showing) preview.innerHTML = renderMarkdown(content.value); // sanitized
    } }, 'Preview');

    editor.append(
      title,
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, type, h('div', { style: 'flex:1' }, picker.el), toggle,
        h('button', { class: 'btn danger', onClick: () => remove(n) }, 'Delete')),
      content, preview,
      h('div', { class: 'hint' }, 'Markdown supported. Saves automatically.'));
    if (n.content) toggle.click(); // open existing notes in preview
  }

  async function create(linkedObjectId = null) {
    try {
      const n = await saver.track(api.notes.create(store.projectId, {
        title: linkedObjectId ? `Note on ${store.objects.get(linkedObjectId)?.name ?? 'object'}` : 'Untitled note',
        type: 'general', linked_object_id: linkedObjectId,
      }));
      notes.push(n);
      activeId = n.id;
      renderList();
      renderEditor();
      editor.querySelector('input')?.select();
    } catch (e) { toastError(e); }
  }

  async function remove(n) {
    if (!(await confirmDialog({ title: 'Delete note?', message: `"${n.title}" will be permanently deleted.` }))) return;
    try {
      await saver.track(api.notes.remove(n.id));
      notes = notes.filter((x) => x.id !== n.id);
      activeId = sorted()[0]?.id ?? null;
      renderList();
      renderEditor();
    } catch (e) { toastError(e); }
  }

  load();
  return () => container.classList.remove('flush');
}
