import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { DispatchSession } from './engine.js';
import { packGraph } from './graph.js';
import type { Locale, Persona, ProtocolPack, SessionEvent } from './types.js';

/**
 * The dispatcher as a service.
 *
 * The library is only reachable from JavaScript. An AI caller, a crash-detection
 * client, an alarm integration or a practice UI is usually neither in this
 * process nor in this language, and each of them needs the same thing: hold a
 * call, get what the dispatcher said, send back what the caller said. That is
 * three endpoints over `node:http` — no dependency, and nothing here that the
 * library cannot already do.
 *
 * SIMULATION ONLY. This binds to loopback by default and has no authentication,
 * because it is a test fixture. Do not put it on a public interface, and do not
 * wire it to anything that answers real calls.
 */

export const SIMULATION_NOTICE =
  'SIMULATION ONLY — this is not a real emergency service and gives no medical advice. In a real emergency, call your local emergency number.';

export interface ServerOptions {
  packs: ProtocolPack[];
  /** Concurrent calls held in memory before the oldest idle one is dropped. */
  maxCalls?: number;
  /** Milliseconds a call may sit idle before it is swept (default 30 min). */
  idleTimeoutMs?: number;
  /** Send permissive CORS headers. Off unless a browser client needs it. */
  cors?: boolean;
  /** Largest accepted request body, in bytes (default 64 KiB). */
  maxBodyBytes?: number;
}

interface HeldCall {
  id: string;
  pack: ProtocolPack;
  locale: Locale;
  session: DispatchSession;
  events: SessionEvent[];
  lastTouched: number;
}

const json = (res: ServerResponse, status: number, body: unknown, cors: boolean): void => {
  const payload = JSON.stringify({ notice: SIMULATION_NOTICE, ...(body as object) }, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(cors
      ? {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        }
      : {}),
  });
  res.end(payload);
};

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { status: 400 });
  }
}

const describe = (pack: ProtocolPack) => ({
  id: pack.id,
  name: pack.name,
  schemaVersion: pack.schemaVersion,
  jurisdiction: pack.jurisdiction,
  locales: pack.locales,
  defaultLocale: pack.defaultLocale,
  protocols: pack.protocols.length,
  scripts: pack.scripts?.length ?? 0,
  provenance: pack.provenance,
});

const stateOf = (call: HeldCall) => ({
  call: call.id,
  pack: call.pack.id,
  locale: call.locale,
  done: call.session.isDone(),
  pending: call.session.pending(),
  result: call.session.isDone() ? call.session.result() : null,
});

export function createDispatchServer(options: ServerOptions): Server {
  const {
    packs,
    maxCalls = 500,
    idleTimeoutMs = 30 * 60 * 1000,
    cors = false,
    maxBodyBytes = 64 * 1024,
  } = options;
  const byId = new Map<string, ProtocolPack>(packs.map((p) => [p.id, p]));
  const calls = new Map<string, HeldCall>();

  /** Drop calls nobody is holding any more, oldest first if we are at capacity. */
  const sweep = () => {
    const now = Date.now();
    for (const [id, call] of calls) {
      if (now - call.lastTouched > idleTimeoutMs) calls.delete(id);
    }
    while (calls.size >= maxCalls) {
      const oldest = [...calls.entries()].sort((a, b) => a[1].lastTouched - b[1].lastTouched)[0];
      if (!oldest) break;
      calls.delete(oldest[0]);
    }
  };

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';

      try {
        if (method === 'OPTIONS') return json(res, 204, {}, cors);

        if (path === '/' || path === '/health') {
          return json(res, 200, { ok: true, packs: packs.map((p) => p.id), calls: calls.size }, cors);
        }

        if (path === '/packs' && method === 'GET') {
          return json(res, 200, { packs: packs.map(describe) }, cors);
        }

        const packGraphMatch = /^\/packs\/([^/]+)\/graph$/.exec(path);
        if (packGraphMatch && method === 'GET') {
          const pack = byId.get(decodeURIComponent(packGraphMatch[1]!));
          if (!pack) return json(res, 404, { error: 'no such pack', packs: [...byId.keys()] }, cors);
          return json(res, 200, { graph: packGraph(pack) }, cors);
        }

        const packMatch = /^\/packs\/([^/]+)$/.exec(path);
        if (packMatch && method === 'GET') {
          const pack = byId.get(decodeURIComponent(packMatch[1]!));
          if (!pack) return json(res, 404, { error: 'no such pack', packs: [...byId.keys()] }, cors);
          return json(res, 200, { pack: describe(pack) }, cors);
        }

        if (path === '/calls' && method === 'POST') {
          const body = (await readBody(req, maxBodyBytes)) as {
            pack?: string;
            locale?: string;
            persona?: Persona;
          };
          const pack = byId.get(body.pack ?? '');
          if (!pack) {
            return json(res, 404, { error: 'no such pack', packs: [...byId.keys()] }, cors);
          }
          const locale = body.locale ?? pack.defaultLocale;
          if (!pack.locales.includes(locale)) {
            return json(res, 400, { error: `pack "${pack.id}" does not speak "${locale}"`, locales: pack.locales }, cors);
          }
          sweep();
          const events: SessionEvent[] = [];
          const session = new DispatchSession(pack, {
            locale,
            ...(body.persona ? { persona: body.persona } : {}),
            onEvent: (e) => events.push(e),
          });
          const say = session.start();
          const call: HeldCall = { id: randomUUID(), pack, locale, session, events, lastTouched: Date.now() };
          calls.set(call.id, call);
          return json(res, 201, { ...stateOf(call), say }, cors);
        }

        const answerMatch = /^\/calls\/([^/]+)\/answer$/.exec(path);
        if (answerMatch && method === 'POST') {
          const call = calls.get(answerMatch[1]!);
          if (!call) return json(res, 404, { error: 'no such call' }, cors);
          if (call.session.isDone()) {
            return json(res, 409, { error: 'the call is already over', ...stateOf(call) }, cors);
          }
          const body = (await readBody(req, maxBodyBytes)) as { text?: unknown };
          if (typeof body.text !== 'string') {
            return json(res, 400, { error: 'expected a JSON body with a string "text"' }, cors);
          }
          call.lastTouched = Date.now();
          const say = call.session.answer(body.text);
          return json(res, 200, { ...stateOf(call), say }, cors);
        }

        const callMatch = /^\/calls\/([^/]+)$/.exec(path);
        if (callMatch && method === 'GET') {
          const call = calls.get(callMatch[1]!);
          if (!call) return json(res, 404, { error: 'no such call' }, cors);
          call.lastTouched = Date.now();
          return json(res, 200, { ...stateOf(call), transcript: call.session.result().transcript }, cors);
        }
        if (callMatch && method === 'DELETE') {
          const existed = calls.delete(callMatch[1]!);
          return json(res, existed ? 200 : 404, { ended: existed }, cors);
        }

        return json(res, 404, { error: 'no such endpoint', endpoints: ENDPOINTS }, cors);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        return json(res, status, { error: (e as Error).message }, cors);
      }
    })();
  });
}

export const ENDPOINTS = [
  'GET    /health',
  'GET    /packs',
  'GET    /packs/:id',
  'GET    /packs/:id/graph',
  'POST   /calls                  { pack, locale?, persona? }',
  'POST   /calls/:id/answer       { text }',
  'GET    /calls/:id',
  'DELETE /calls/:id',
];
