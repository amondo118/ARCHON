import { h } from '../core/dom.js';

let container;

export function toast(message, kind = 'info', ms = 3500) {
  container ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast ${kind}` }, message);
  container.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? ms * 2 : ms);
}

/** Standard handler for failed API calls: never fail silently. */
export function toastError(e) {
  console.error(e);
  toast(e?.message || 'Something went wrong.', 'error');
}
