import { h, clear } from '../core/dom.js';
import { store } from '../core/store.js';

/**
 * Searchable object picker. Calls onPick(object) when the user chooses an item.
 * `exclude` is a predicate for objects that must not be offered.
 */
export function objectPicker({ placeholder = 'Search objects…', onPick, exclude = () => false, initial = null }) {
  const input = h('input', { class: 'input', placeholder, autocomplete: 'off', value: initial ? store.pathOf(initial) : '' });
  const list = h('div', { class: 'picker-list', hidden: true });
  let matches = [];
  let hl = 0;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    matches = [...store.objects.values()]
      .filter((o) => !exclude(o))
      .map((o) => ({ o, path: store.pathOf(o.id) }))
      .filter(({ path }) => !q || path.toLowerCase().includes(q))
      .sort((a, b) => a.path.length - b.path.length)
      .slice(0, 30);
    hl = 0;
    clear(list);
    list.hidden = matches.length === 0;
    matches.forEach(({ o, path }, i) => list.append(h('button', {
      type: 'button',
      class: `picker-item ${i === hl ? 'hl' : ''}`,
      onMousedown: (e) => { e.preventDefault(); choose(i); },
    }, h('span', { class: 'mono' }, path), h('span', { class: 'sub' }, o.type))));
  };
  const choose = (i) => {
    const m = matches[i];
    if (!m) return;
    input.value = m.path;
    list.hidden = true;
    onPick(m.o);
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 100));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = Math.max(0, Math.min(matches.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      [...list.children].forEach((c, i) => c.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      choose(hl);
    }
  });
  return { el: h('div', { class: 'picker' }, input, list), input };
}
