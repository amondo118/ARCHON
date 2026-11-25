/** Minimal pub/sub used by the store. */
export function emitter() {
  const handlers = new Map();
  return {
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add(fn);
      return () => handlers.get(evt).delete(fn);
    },
    emit(evt, payload) {
      for (const fn of handlers.get(evt) ?? []) fn(payload);
    },
  };
}
