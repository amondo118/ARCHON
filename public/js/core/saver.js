import { emitter } from './events.js';

/**
 * Tracks every write so the UI can show Saving… / Saved / Save failed, and so
 * pending debounced writes can be flushed before navigating away.
 */
const bus = emitter();
let inFlight = 0;
let failed = false;
const scheduled = new Map(); // key -> { timer, fn }

const state = () => (inFlight > 0 || scheduled.size > 0 ? 'saving' : failed ? 'failed' : 'saved');
const notify = () => bus.emit('change', state());

export const saver = {
  onChange: (fn) => bus.on('change', fn),
  state,

  /** Wrap a write promise. Re-throws so callers can react to errors. */
  async track(promise) {
    inFlight++;
    notify();
    try {
      const result = await promise;
      failed = false;
      return result;
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      inFlight--;
      notify();
    }
  },

  /** Debounce a write by key; the latest fn for a key wins. */
  schedule(key, fn, ms = 500) {
    const prev = scheduled.get(key);
    if (prev) clearTimeout(prev.timer);
    const entry = { fn, timer: setTimeout(() => run(key), ms) };
    scheduled.set(key, entry);
    notify();
  },

  /** Run every pending debounced write now. */
  async flush() {
    await Promise.allSettled([...scheduled.keys()].map(run));
  },
};

async function run(key) {
  const entry = scheduled.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  scheduled.delete(key);
  try {
    await saver.track(Promise.resolve().then(entry.fn));
  } catch (e) {
    console.error('Save failed', e);
  }
}

window.addEventListener('beforeunload', (e) => {
  if (state() === 'saving') {
    saver.flush();
    e.preventDefault();
  }
});
