import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database/database.js';
import { createApp } from '../server/app.js';

/** Starts an app on an ephemeral port against an in-memory database. */
export async function startServer() {
  const db = openDatabase(':memory:');
  const config = { importLimit: '10mb', backupDir: path.join(os.tmpdir(), 'archon-test-backups') };
  const { app } = createApp(db, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, ...json };
  }
  const api = {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    patch: (u, b) => call('PATCH', u, b),
    put: (u, b) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
    raw: (u) => fetch(base + u),
  };
  return { api, db, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

/** Throws with a readable message if the call did not succeed. */
export function must(res) {
  if (!res.success) throw new Error(`API ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}
