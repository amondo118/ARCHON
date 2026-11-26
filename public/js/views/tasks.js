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
  const marker = h('div', { class: 'drop-marker' });

  /** The card the pointer is above (insert before it), or null for the end of the column. */
  const cardAfterPointer = (body, y) => [...body.querySelectorAll('.task-card:not(.dragging)')]
    .find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    }) ?? null;

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
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
        const before = cardAfterPointer(body, e.clientY);
        if (before) body.insertBefore(marker, before); else body.append(marker);
      });
      col.addEventListener('dragleave', (e) => {
        if (col.contains(e.relatedTarget)) return;
        col.classList.remove('drag-over');
        marker.remove();
      });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const before = cardAfterPointer(body, e.clientY);
        marker.remove();
        const id = e.dataTransfer.getData('text/x-archon-task');
        if (id) move(id, status, before?.dataset.task ?? null);
      });
      board.append(col);
    }
  }

  function card(t) {
    const obj = t.linked_object_id ? store.objects.get(t.linked_object_id) : null;
    const el = h('article', {
      class: `task-card prio-${t.priority}`, draggable: 'true', tabindex: 0, dataset: { task: t.id },
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
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); marker.remove(); });
    return el;
  }

  /**
   * Move a task to `status`, placed before task `beforeId` (null = end of column).
   * Uses the midpoint between neighbours' sort_order; renumbers the column only
   * when there is no room left between them.
   */
  async function move(id, status, beforeId) {
    const t = tasks.find((x) => x.id === id);
    if (!t || beforeId === id) return;
    const column = tasks.filter((x) => x.status === status && x.id !== id).sort((a, b) => a.sort_order - b.sort_order);
    let index = beforeId ? column.findIndex((x) => x.id === beforeId) : column.length;
    if (index < 0) index = column.length;
    const prev = column[index - 1];
    const next = column[index];
    if (t.status === status) {
      const current = tasks.filter((x) => x.status === status).sort((a, b) => a.sort_order - b.sort_order);
      const i = current.indexOf(t);
      if (current[i - 1]?.id === prev?.id && current[i + 1]?.id === next?.id) return; // dropped where it already is
    }

    const updates = new Map(); // task id -> patch
    let order;
    if (!prev && !next) order = Date.now();
    else if (!prev) order = next.sort_order - 1024;
    else if (!next) order = prev.sort_order + 1024;
    else order = Math.floor((prev.sort_order + next.sort_order) / 2);

    if ((prev && order <= prev.sort_order) || (next && order >= next.sort_order)) {
      // No integer gap left: renumber the whole column with even spacing.
      const ordered = [...column.slice(0, index), t, ...column.slice(index)];
      ordered.forEach((x, i) => {
        const so = (i + 1) * 1024;
        if (x === t) order = so;
        else if (x.sort_order !== so) updates.set(x.id, { sort_order: so });
      });
    }
    updates.set(t.id, { status, sort_order: order });

    const snapshot = tasks.map((x) => ({ ...x }));
    for (const [tid, patch] of updates) Object.assign(tasks.find((x) => x.id === tid), patch); // optimistic
    render();
    try {
      for (const [tid, patch] of updates) {
        Object.assign(tasks.find((x) => x.id === tid), await saver.track(api.tasks.update(tid, patch)));
      }
    } catch (e) {
      tasks = snapshot;
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
