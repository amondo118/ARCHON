import { h, iconButton } from '../core/dom.js';

/**
 * Opens a modal. `body` is a node; `actions` is [{label, kind, value, onClick}].
 * Resolves with the clicked action's value (or null when dismissed).
 * An action's onClick may return false (or a promise of false) to keep the modal open.
 */
export function openModal({ title, body, actions = [], wide = false, initialFocus }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    };
    const buttons = actions.map((a) => h('button', {
      class: `btn ${a.kind ?? ''}`,
      type: a.submit ? 'submit' : 'button',
      onClick: async (e) => {
        if (a.submit) return; // handled by form submit
        e.preventDefault();
        if (a.onClick && (await a.onClick()) === false) return;
        close(a.value ?? a.label);
      },
    }, a.label));
    const submitAction = actions.find((a) => a.submit);
    const form = h('form', {
      class: `modal ${wide ? 'wide' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      onSubmit: async (e) => {
        e.preventDefault();
        if (!submitAction) return;
        if (submitAction.onClick && (await submitAction.onClick()) === false) return;
        close(submitAction.value ?? submitAction.label);
      },
    },
    h('div', { class: 'modal-head' }, h('h2', {}, title), iconButton('x', 'Close', () => close(null))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, buttons) : null);

    const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (e) => { if (e.target === backdrop) close(null); } }, form);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    (initialFocus ?? form.querySelector('input, select, textarea, .btn.primary'))?.focus();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true, extra }) {
  const result = await openModal({
    title,
    body: h('div', {}, h('p', { style: 'margin:0' }, message), extra),
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, kind: danger ? 'danger solid' : 'primary', value: true, submit: true },
    ],
  });
  return result === true;
}
