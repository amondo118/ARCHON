import { h, human, statusBadge } from '../core/dom.js';
import { store } from '../core/store.js';
import { api } from '../api/client.js';
import { toastError } from '../components/toast.js';

/** Project dashboard. Every number is derived from stored data on the server. */
export function mountOverview(container) {
  let alive = true;
  api.projects.stats(store.projectId).then((s) => alive && render(s)).catch(toastError);

  function render(s) {
    const healthCount = Object.fromEntries(s.health.map((x) => [x.status, x.count]));
    const taskCount = Object.fromEntries(s.tasks.map((x) => [x.status, x.count]));
    const totalTasks = s.tasks.reduce((a, x) => a + x.count, 0);
    const done = taskCount.done ?? 0;
    const open = (id) => { store.focus(id); location.hash = `#/${store.projectId}/architecture`; };

    container.append(
      h('h1', { class: 'page-title' }, s.project.name),
      h('p', { class: 'page-sub' }, s.project.description || 'No description yet. Add one in Settings.'),
      h('div', { class: 'cards' },
        card(s.modules, 'Modules'), card(s.objects, 'Architecture objects'), card(s.relationships, 'Relationships'),
        card(totalTasks ? `${Math.round((done / totalTasks) * 100)}%` : '—', `Tasks done (${done}/${totalTasks})`)),
      h('div', { class: 'panels' },
        h('div', { class: 'panel' }, h('h3', {}, 'Health'),
          stackBar(store.meta.healthStatuses.map((st) => [st, healthCount[st] ?? 0, `var(--${st})`])),
          h('div', { class: 'legend-row' }, store.meta.healthStatuses.map((st) => h('span', {}, statusBadge(st), ' ', healthCount[st] ?? 0)))),
        h('div', { class: 'panel' }, h('h3', {}, 'Task progress'),
          stackBar(store.meta.taskStatuses.map((st, i) => [st, taskCount[st] ?? 0,
            st === 'done' ? 'var(--good)' : `color-mix(in srgb, var(--accent) ${30 + i * 15}%, var(--surface-2))`])),
          h('div', { class: 'legend-row' }, store.meta.taskStatuses.map((st) => h('span', {}, `${human(st)}: ${taskCount[st] ?? 0}`)))),
        h('div', { class: 'panel' }, h('h3', {}, 'Needs attention'),
          s.attention.length
            ? h('ul', { class: 'row-list' }, s.attention.map((o) => h('li', {}, statusBadge(o.health_status),
              h('button', { class: 'link grow mono', onClick: () => open(o.id) }, o.name), h('span', { class: 'type-tag' }, o.type))))
            : h('p', { class: 'hint' }, 'Nothing marked warning or bad.')),
        h('div', { class: 'panel' }, h('h3', {}, 'Recently modified'),
          s.recent.length
            ? h('ul', { class: 'row-list' }, s.recent.map((o) => h('li', {},
              h('button', { class: 'link grow mono', onClick: () => open(o.id) }, o.name),
              h('span', { class: 'hint' }, new Date(o.updated_at).toLocaleString()))))
            : h('p', { class: 'hint' }, 'No objects yet.'))));
  }
  return () => { alive = false; };
}

const card = (num, label) => h('div', { class: 'card' }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label));

function stackBar(parts) {
  const total = parts.reduce((a, [, n]) => a + n, 0) || 1;
  return h('div', { class: 'bar', role: 'img', 'aria-label': parts.map(([l, n]) => `${l}: ${n}`).join(', ') },
    parts.filter(([, n]) => n).map(([l, n, color]) => h('div', { title: `${human(l)}: ${n}`, style: `width:${(n / total) * 100}%;background:${color}` })));
}
