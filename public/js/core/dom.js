/**
 * Tiny element builder. Children may be strings, nodes, arrays, or falsy (skipped).
 * Attributes starting with "on" become event listeners; `class` and `style` work as usual.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(name, cls = '') {
  return h('span', { class: `icon ${cls}`, style: `--icon:url(/vendor/icons/${name}.svg)`, 'aria-hidden': 'true' });
}

export function iconButton(name, title, onClick, cls = 'ghost') {
  return h('button', { class: `btn icon-only ${cls}`, title, 'aria-label': title, onClick }, icon(name));
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function options(values, selected, labelFn = (v) => v) {
  return values.map((v) => h('option', { value: v, selected: v === selected }, labelFn(v)));
}

export const human = (s) => String(s ?? '').replace(/_/g, ' ');

export function statusBadge(status) {
  return h('span', { class: `badge ${status}` }, human(status));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
