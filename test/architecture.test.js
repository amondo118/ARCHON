import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, must } from './helpers.js';

let ctx; let api; let pid;
before(async () => {
  ctx = await startServer();
  api = ctx.api;
  pid = must(await api.post('/projects', { name: 'Medieval Empire' })).id;
});
after(() => ctx.close());

const obj = async (body) => must(await api.post(`/projects/${pid}/objects`, body));

test('health and meta', async () => {
  assert.equal(must(await api.get('/health')).status, 'ok');
  assert.ok(must(await api.get('/meta')).objectTypes.includes('class'));
});

test('project validation and default canvas', async () => {
  const bad = await api.post('/projects', { name: '  ' });
  assert.equal(bad.status, 400);
  assert.equal(bad.error.code, 'VALIDATION_ERROR');
  const canvases = must(await api.get(`/projects/${pid}/canvases`));
  assert.equal(canvases.length, 1);
});

test('parent/child type rules', async () => {
  const cls = await obj({ type: 'class', name: 'Villager' });
  const m = await obj({ type: 'method', name: 'move()', parent_id: cls.id });
  assert.equal(m.parent_id, cls.id);
  assert.equal((await api.post(`/projects/${pid}/objects`, { type: 'method', name: 'orphan()' })).status, 400);
  assert.equal((await api.post(`/projects/${pid}/objects`, { type: 'method', name: 'x', parent_id: m.id })).status, 400);
  assert.equal((await api.post(`/projects/${pid}/objects`, { type: 'widget', name: 'x' })).status, 400);
  // Nested class is fine; a class can't become a method while it has children.
  await obj({ type: 'class', name: 'Inner', parent_id: cls.id });
  assert.equal((await api.patch(`/objects/${cls.id}`, { type: 'method' })).status, 400);
  // Cannot move an object inside its own descendant.
  const inner = await obj({ type: 'class', name: 'Inner2', parent_id: cls.id });
  assert.equal((await api.patch(`/objects/${cls.id}`, { parent_id: inner.id })).status, 400);
});

test('children follow their parent module', async () => {
  const mod = must(await api.post(`/projects/${pid}/modules`, { name: 'AI' }));
  const cls = await obj({ type: 'class', name: 'Brain', module_id: mod.id });
  const m = await obj({ type: 'method', name: 'think()', parent_id: cls.id, module_id: null });
  assert.equal(m.module_id, mod.id);
  const mod2 = must(await api.post(`/projects/${pid}/modules`, { name: 'Core' }));
  must(await api.patch(`/objects/${cls.id}`, { module_id: mod2.id }));
  assert.equal(must(await api.get(`/objects/${m.id}`)).object.module_id, mod2.id);
  assert.equal((await api.patch(`/objects/${m.id}`, { module_id: mod.id })).status, 400);
});

test('relationship rules: self, duplicates, cross-project, inheritance', async () => {
  const a = await obj({ type: 'class', name: 'A' });
  const b = await obj({ type: 'class', name: 'B' });
  const c = await obj({ type: 'class', name: 'C' });
  const i = await obj({ type: 'interface', name: 'IThing' });
  const rel = (body) => api.post(`/projects/${pid}/relationships`, body);

  assert.equal((await rel({ source_id: a.id, target_id: a.id, type: 'uses' })).status, 400);
  must(await rel({ source_id: a.id, target_id: b.id, type: 'uses' }));
  assert.equal((await rel({ source_id: a.id, target_id: b.id, type: 'uses' })).status, 409);
  must(await rel({ source_id: a.id, target_id: b.id, type: 'calls' })); // different type is fine

  must(await rel({ source_id: a.id, target_id: b.id, type: 'inherits' }));
  must(await rel({ source_id: b.id, target_id: c.id, type: 'inherits' }));
  assert.equal((await rel({ source_id: c.id, target_id: a.id, type: 'inherits' })).status, 400, 'cycle');
  assert.equal((await rel({ source_id: a.id, target_id: c.id, type: 'inherits' })).status, 409, 'single inheritance');
  assert.equal((await rel({ source_id: a.id, target_id: i.id, type: 'inherits' })).status, 400, 'class !inherits interface');
  must(await rel({ source_id: a.id, target_id: i.id, type: 'implements' }));
  assert.equal((await rel({ source_id: i.id, target_id: a.id, type: 'implements' })).status, 400);

  const other = must(await api.post('/projects', { name: 'Other' }));
  const x = must(await api.post(`/projects/${other.id}/objects`, { type: 'class', name: 'X' }));
  assert.equal((await rel({ source_id: a.id, target_id: x.id, type: 'uses' })).status, 400, 'cross-project');
});

test('delete impact and cascade semantics', async () => {
  const cls = await obj({ type: 'class', name: 'Doomed' });
  const m1 = await obj({ type: 'method', name: 'a()', parent_id: cls.id });
  await obj({ type: 'property', name: 'p', parent_id: cls.id });
  const other = await obj({ type: 'class', name: 'Survivor' });
  must(await api.post(`/projects/${pid}/relationships`, { source_id: other.id, target_id: m1.id, type: 'calls' }));
  const task = must(await api.post(`/projects/${pid}/tasks`, { title: 'Fix a()', linked_object_id: m1.id }));
  const note = must(await api.post(`/projects/${pid}/notes`, { title: 'Why', linked_object_id: cls.id }));

  const impact = must(await api.get(`/objects/${cls.id}/delete-impact`));
  assert.deepEqual([impact.children, impact.relationships, impact.tasks, impact.notes], [2, 1, 1, 1]);

  must(await api.del(`/objects/${cls.id}`));
  assert.equal((await api.get(`/objects/${m1.id}`)).status, 404);
  assert.equal(must(await api.get(`/objects/${other.id}`)).outgoing.length, 0);
  assert.equal(must(await api.get(`/tasks/${task.id}`)).linked_object_id, null);
  assert.equal(must(await api.get(`/notes/${note.id}`)).linked_object_id, null);
});

test('deleting a module keeps objects and lifts sub-modules', async () => {
  const parent = must(await api.post(`/projects/${pid}/modules`, { name: 'World' }));
  const child = must(await api.post(`/projects/${pid}/modules`, { name: 'Terrain', parent_module_id: parent.id }));
  assert.equal((await api.patch(`/modules/${parent.id}`, { parent_module_id: child.id })).status, 400, 'cycle');
  const o = await obj({ type: 'class', name: 'Tile', module_id: parent.id });
  must(await api.del(`/modules/${parent.id}`));
  assert.equal(must(await api.get(`/modules/${child.id}`)).parent_module_id, null);
  assert.equal(must(await api.get(`/objects/${o.id}`)).object.module_id, null);
});

test('canvas positions: save, promote, remove, validation', async () => {
  const [canvas] = must(await api.get(`/projects/${pid}/canvases`));
  const cls = await obj({ type: 'class', name: 'Placed' });
  const m = await obj({ type: 'method', name: 'go()', parent_id: cls.id });
  must(await api.put(`/canvases/${canvas.id}/positions`, {
    positions: [{ object_id: cls.id, x: 10, y: 20, collapsed: true }, { object_id: m.id, x: 300, y: 40 }],
  }));
  let graph = must(await api.get(`/projects/${pid}/graph`));
  assert.equal(graph.positions.find((p) => p.object_id === cls.id).collapsed, true);
  assert.ok(graph.positions.some((p) => p.object_id === m.id));
  must(await api.put(`/canvases/${canvas.id}/positions`, { remove: [m.id] }));
  graph = must(await api.get(`/projects/${pid}/graph`));
  assert.ok(!graph.positions.some((p) => p.object_id === m.id));
  assert.equal(must(await api.get(`/objects/${m.id}`)).object.parent_id, cls.id, 'promotion never changes parent');
  assert.equal((await api.put(`/canvases/${canvas.id}/positions`, { positions: [{ object_id: 'nope', x: 1, y: 1 }] })).status, 400);
});

test('tasks validate status and references', async () => {
  assert.equal((await api.post(`/projects/${pid}/tasks`, { title: 'x', status: 'someday' })).status, 400);
  assert.equal((await api.post(`/projects/${pid}/tasks`, { title: 'x', due_date: '12/01/2026' })).status, 400);
  const t = must(await api.post(`/projects/${pid}/tasks`, { title: 'Ship', due_date: '2026-12-01' }));
  assert.equal(must(await api.patch(`/tasks/${t.id}`, { status: 'done' })).status, 'done');
});

test('invalid JSON and unknown ids return clean errors', async () => {
  const res = await api.raw('/projects/does-not-exist');
  assert.equal(res.status, 404);
  const bad = await fetch((await api.raw('/health')).url.replace('/health', '/projects'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_JSON');
});
