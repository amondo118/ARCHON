import { h, icon, options, human, clear } from '../core/dom.js';
import { store } from '../core/store.js';
import { api } from '../api/client.js';
import { saver } from '../core/saver.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { objectPicker } from '../components/picker.js';
import { toastError } from '../components/toast.js';

const COLUMN_LABEL = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' };

/** Kanban board. Native HTML5 drag and drop; dropping a card updates its status. */
export function mountTasks(container) {
  let tasks = [];
  const filters = { q: '', priority: '', linked: '' };
  const board = h('div', { class: 'board' });

  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filter tasks…', style: 'width:220px' });
  q.addEventListener('input', () => { filters.q = q.value.toLowerCase(); render(); });
  const prio = h('select', { class: 'input' }, h('option', { value: '' }, 'Any priority'), options(store.meta.taskPriorities, '', human));
  prio.addEventListener('change', () => { filters.priority = prio.value; render(); });
  const linked = h('select', { class: 'input' }, options(['', 'linked', 'unlinked'], '', (v) => ({ '': 'Linked or not', linked: 'Linked to object', unlinked: 'Not linked' }[v])));
  linked.addEventListener('change', () => { filters.linked = linked.value; render(); });

  container.append(
    h('div', { class: 'board-bar' },
      h('button', { class: 'btn primary', onClick: () => editTask(null) }, icon('plus'), 'New task'),
      q, prio, linked),
    board);

  async function load() {
    try {
      tasks = await api.tasks.list(store.projectId);
      render();
    } catch (e) { toastError(e); }
  }

  const visible = (t) => (!filters.q || `${t.title} ${t.description}`.toLowerCase().includes(filters.q))
    && (!filters.priority || t.priority === filters.priority)
    && (!filters.linked || (filters.linked === 'linked') === Boolean(t.linked_object_id));

  function render() {
    clear(board);
    for (const status of store.meta.taskStatuses) {
      const items = tasks.filter((t) => t.status === status && visible(t)).sort((a, b) => a.sort_order - b.sort_order);
      const body = h('div', { class: 'column-body' }, items.map(card));
      const col = h('section', { class: 'column', 'aria-label': COLUMN_LABEL[status] },
        h('div', { class: 'column-head' }, h('span', {}, COLUMN_LABEL[status] ?? human(status)), h('span', {}, items.length)),
        body);
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/x-archon-task');
        if (id) move(id, status);
      });
      board.append(col);
    }
  }

  function card(t) {
    const obj = t.linked_object_id ? store.objects.get(t.linked_object_id) : null;
    const el = h('article', {
      class: `task-card prio-${t.priority}`, draggable: 'true', tabindex: 0,
      onClick: () => editTask(t),
      onKeydown: (e) => { if (e.key === 'Enter') editTask(t); },
    },
    h('div', { class: 't' }, t.title),
    h('div', { class: 'm' },
      h('span', { class: 'badge plain' }, t.priority),
      t.due_date ? h('span', {}, `due ${t.due_date}`) : null,
      obj ? h('button', {
        class: 'link mono',
        onClick: (e) => { e.stopPropagation(); store.focus(obj.id); location.hash = `#/${store.projectId}/architecture`; },
      }, store.pathOf(obj.id)) : null));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-archon-task', t.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }

  async function move(id, status) {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const prev = t.status;
    t.status = status; // optimistic
    t.sort_order = Date.now();
    render();
    try {
      Object.assign(t, await saver.track(api.tasks.update(id, { status, sort_order: t.sort_order })));
    } catch (e) {
      t.status = prev;
      render();
      toastError(e);
    }
  }

  async function editTask(task) {
    const t = task ?? { title: '', description: '', status: 'todo', priority: 'medium', due_date: null, linked_object_id: null };
    let linkedId = t.linked_object_id;
    const title = h('input', { class: 'input', value: t.title, required: true, maxlength: 300 });
    const desc = h('textarea', { class: 'input', rows: 4 }, t.description);
    const status = h('select', { class: 'input' }, options(store.meta.taskStatuses, t.status, (s) => COLUMN_LABEL[s] ?? human(s)));
    const priority = h('select', { class: 'input' }, options(store.meta.taskPriorities, t.priority, human));
    const due = h('input', { class: 'input', type: 'date', value: t.due_date ?? '' });
    const picker = objectPicker({ placeholder: 'Link to object (optional)', initial: linkedId, onPick: (o) => { linkedId = o.id; } });
    picker.input.addEventListener('input', () => { if (!picker.input.value.trim()) linkedId = null; });

    const actions = [
      { label: 'Cancel' },
      {
        label: task ? 'Save' : 'Create', kind: 'primary', submit: true,
        onClick: async () => {
          const body = {
            title: title.value, description: desc.value, status: status.value, priority: priority.value,
            due_date: due.value || null, linked_object_id: linkedId,
          };
          try {
            if (task) Object.assign(task, await saver.track(api.tasks.update(task.id, body)));
            else tasks.push(await saver.track(api.tasks.create(store.projectId, body)));
            render();
          } catch (e) { toastError(e); return false; }
        },
      },
    ];
    if (task) {
      actions.unshift({
        label: 'Delete', kind: 'danger',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete task?', message: `"${task.title}" will be permanently deleted.` }))) return false;
          try {
            await saver.track(api.tasks.remove(task.id));
            tasks = tasks.filter((x) => x.id !== task.id);
            render();
          } catch (e) { toastError(e); return false; }
        },
      });
    }
    await openModal({
      title: task ? 'Edit task' : 'New task',
      wide: true,
      initialFocus: title,
      body: h('div', {},
        h('div', { class: 'field' }, h('label', {}, 'Title'), title),
        h('div', { class: 'field' }, h('label', {}, 'Description'), desc),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', {}, 'Status'), status),
          h('div', { class: 'field' }, h('label', {}, 'Priority'), priority)),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', {}, 'Due date'), due),
          h('div', { class: 'field' }, h('label', {}, 'Linked object'), picker.el))),
      actions,
    });
  }

  container.classList.add('flush');
  load();
  return () => container.classList.remove('flush');
}
