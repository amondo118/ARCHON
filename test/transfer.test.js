import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, must } from './helpers.js';

const SAMPLE = JSON.parse(fs.readFileSync(new URL('../examples/medieval-empire.archon.json', import.meta.url), 'utf8'));

let ctx; let api;
before(async () => { ctx = await startServer(); api = ctx.api; });
after(() => ctx.close());

test('imports the sample file', async () => {
  const { project, counts } = must(await api.post('/projects/import', SAMPLE));
  assert.equal(project.name, SAMPLE.project.name);
  assert.deepEqual(counts, { modules: 3, objects: 22, relationships: 8, tasks: 3, notes: 1 });
  const graph = must(await api.get(`/projects/${project.id}/graph`));
  const byName = (n) => graph.objects.find((o) => o.name === n);
  const gather = byName('gather_resource()');
  assert.equal(gather.parent_id, byName('Villager').id);
  assert.equal(gather.module_id, byName('Villager').module_id, 'children inherit module');
  // "Villager.gather_resource" (no parens) resolved leniently.
  assert.ok(graph.relationships.some((r) => r.source_id === gather.id && r.target_id === byName('find_nearest()').id));
  assert.equal(graph.positions.length, 7);
});

test('export → import round trip preserves the project', async () => {
  const { project } = must(await api.post('/projects/import', SAMPLE));
  const exported = await (await api.raw(`/projects/${project.id}/export`)).json();
  assert.equal(exported.format, 'archon');
  const again = must(await api.post('/projects/import', exported));
  assert.notEqual(again.project.id, project.id, 'import always creates a new project');

  const strip = (g) => ({
    objects: g.objects.map((o) => `${o.type}:${o.name}:${o.health_status}`).sort(),
    rels: g.relationships.length,
    positions: g.positions.length,
  });
  const a = must(await api.get(`/projects/${project.id}/graph`));
  const b = must(await api.get(`/projects/${again.project.id}/graph`));
  assert.deepEqual(strip(a), strip(b));
  const exported2 = await (await api.raw(`/projects/${again.project.id}/export`)).json();
  delete exported.exported_at; delete exported2.exported_at;
  assert.deepEqual(exported2, exported, 'second export is identical');
});

test('reports every structural error with a path', async () => {
  const res = await api.post('/projects/import', {
    format: 'archon',
    project: {},
    modules: [{ name: 'A' }, { name: 'A' }],
    objects: [{ type: 'class', name: 'X', module: 'missing' }, { type: 'class', name: 'X' }],
    relationships: [{ source: 'X', target: 'Nope', type: 'uses' }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.error.code, 'IMPORT_INVALID');
  const paths = res.error.details.map((d) => d.path);
  assert.deepEqual(paths, ['project.name', 'modules[1]', 'objects[0].module', 'objects[1]', 'relationships[0].target']);
});

test('business-rule failures roll back the whole import', async () => {
  const before = must(await api.get('/projects')).length;
  const res = await api.post('/projects/import', {
    project: { name: 'Broken' },
    objects: [{ type: 'class', name: 'A' }, { type: 'method', name: 'loose()' }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.error.details[0].path, 'objects[1]');
  assert.match(res.error.details[0].message, /must belong to a parent/);
  assert.equal(must(await api.get('/projects')).length, before, 'nothing was created');
});

test('minimal file: only project name and objects', async () => {
  const { counts } = must(await api.post('/projects/import', {
    project: { name: 'Tiny' }, objects: [{ type: 'class', name: 'Solo' }],
  }));
  assert.equal(counts.objects, 1);
});
