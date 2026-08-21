import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createDispatchServer, loadPackFromFile, SIMULATION_NOTICE } from '../src/index.js';
import type { ProtocolPack } from '../src/index.js';

const packsDir = fileURLToPath(new URL('../packs', import.meta.url));
const packs: ProtocolPack[] = readdirSync(packsDir).map((d) =>
  loadPackFromFile(join(packsDir, d, 'pack.json')),
);

const server = createDispatchServer({ packs, maxCalls: 8, idleTimeoutMs: 60_000 });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

test('every response says what this is', async () => {
  for (const path of ['/health', '/packs', '/nope']) {
    const { body } = await get(path);
    assert.equal(body['notice'], SIMULATION_NOTICE, path);
  }
});

test('the corpus is discoverable without loading the library', async () => {
  const { status, body } = await get('/packs');
  assert.equal(status, 200);
  const listed = body['packs'] as { id: string; locales: string[]; protocols: number }[];
  assert.equal(listed.length, packs.length);
  const flagship = listed.find((p) => p.id === 'us-openises-emd')!;
  assert.deepEqual(flagship.locales, ['en', 'es', 'fr']);
  assert.ok(flagship.protocols > 30);
});

test('a whole call runs over HTTP and reaches a response level', async () => {
  const start = await post('/calls', { pack: 'us-openises-emd', locale: 'es' });
  assert.equal(start.status, 201);
  const id = start.body['call'] as string;
  assert.ok(id);
  assert.equal((start.body['say'] as unknown[]).length > 0, true);

  const answers: Record<string, string> = {
    location: 'Calle Reforma 10',
    callback: '555-0100',
    emergency: 'le duele el pecho',
    num_hurt: 'uno',
    age: '58',
    conscious: 'sí',
    breathing: 'sí',
    sex: 'hombre',
    caller_name: 'Ana',
  };

  let state = start.body;
  let guard = 0;
  while (!state['done'] && guard++ < 60) {
    const pending = state['pending'] as { slot: string } | null;
    if (!pending) break;
    const next = await post(`/calls/${id}/answer`, { text: answers[pending.slot] ?? 'no' });
    assert.equal(next.status, 200);
    state = next.body;
  }
  assert.equal(state['done'], true);
  const result = state['result'] as { protocolId: string; response: string; transcript: unknown[] };
  assert.equal(result.protocolId, 'm5_chest_pain');
  assert.ok(result.response);

  // …and the finished call can be fetched back with its transcript.
  const fetched = await get(`/calls/${id}`);
  assert.equal(fetched.status, 200);
  assert.ok((fetched.body['transcript'] as unknown[]).length > 0);
});

test('a persona is honoured over the wire without changing the outcome', async () => {
  const run = async (persona?: unknown) => {
    const start = await post('/calls', { pack: 'us-nhtsa-emd', ...(persona ? { persona } : {}) });
    const id = start.body['call'] as string;
    const answers: Record<string, string> = {
      address: '12 Pine St', callback: '555-0100', complaint: 'chest pain',
      age: '58', conscious: 'yes', breathing: 'yes',
    };
    let state = start.body;
    let guard = 0;
    while (!state['done'] && guard++ < 40) {
      const pending = state['pending'] as { slot: string } | null;
      if (!pending) break;
      state = (await post(`/calls/${id}/answer`, { text: answers[pending.slot] ?? 'no' })).body;
    }
    return state['result'] as { determinantId: string; response: string; transcript: { text: string }[] };
  };
  const plain = await run();
  const chatty = await run({ seed: 7, confirmRate: 1, clarifyAttempts: 2 });
  assert.equal(chatty.determinantId, plain.determinantId);
  assert.equal(chatty.response, plain.response);
  assert.ok(chatty.transcript.length >= plain.transcript.length, 'the read-backs are extra talk');
});

test('the errors a client will actually hit are answered clearly', async () => {
  assert.equal((await post('/calls', { pack: 'nope' })).status, 404);

  const badLocale = await post('/calls', { pack: 'us-nj-emd', locale: 'de' });
  assert.equal(badLocale.status, 400);
  assert.match(badLocale.body['error'] as string, /does not speak "de"/);

  assert.equal((await post('/calls/not-a-call/answer', { text: 'hello' })).status, 404);
  assert.equal((await get('/calls/not-a-call')).status, 404);

  const started = await post('/calls', { pack: 'us-nhtsa-emd' });
  const id = started.body['call'] as string;
  assert.equal((await post(`/calls/${id}/answer`, { text: 42 })).status, 400);

  const missing = await get('/nope');
  assert.equal(missing.status, 404);
  assert.ok(Array.isArray(missing.body['endpoints']));
});

test('answering a finished call is a conflict, not a crash', async () => {
  const start = await post('/calls', { pack: 'us-nhtsa-emd' });
  const id = start.body['call'] as string;
  let state = start.body;
  let guard = 0;
  while (!state['done'] && guard++ < 40) {
    const pending = state['pending'] as { slot: string } | null;
    if (!pending) break;
    state = (await post(`/calls/${id}/answer`, { text: 'no' })).body;
  }
  assert.equal(state['done'], true);
  const after = await post(`/calls/${id}/answer`, { text: 'hello?' });
  assert.equal(after.status, 409);
  assert.match(after.body['error'] as string, /already over/);
});

test('a call can be hung up, and the graph is servable for a visualizer', async () => {
  const start = await post('/calls', { pack: 'us-nhtsa-emd' });
  const id = start.body['call'] as string;
  const res = await fetch(`${base}/calls/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await get(`/calls/${id}`)).status, 404);

  const graph = await get('/packs/us-nhtsa-emd/graph');
  assert.equal(graph.status, 200);
  const g = graph.body['graph'] as { nodes: unknown[]; edges: unknown[] };
  assert.ok(g.nodes.length > 0 && g.edges.length > 0);
});

test('held calls are capped so a forgotten client cannot grow the heap', async () => {
  for (let i = 0; i < 20; i++) await post('/calls', { pack: 'us-nhtsa-emd' });
  const { body } = await get('/health');
  assert.ok((body['calls'] as number) <= 8, `held ${body['calls']} calls against a cap of 8`);
});
