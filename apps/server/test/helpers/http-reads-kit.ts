import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicMatch } from '@mbrg/protocol';
import { productionRoutes } from '../../src/http/server';
import { request } from './http-client';
import type { ClientReply } from './http-client';
import { startServer } from './server-harness';
import type { ServerHarness, ServerHarnessOptions } from './server-harness';
import { OPERATOR, creationBody } from './service-harness';

// Shared setup of the read-route tests (M3a' T3'): a production-routes server with limits raised so a test sends as many
// requests as it needs, a GET helper, and matches created and stepped through the service API (the commands themselves
// are covered over HTTP in http-commands.test.ts).

export const startReads = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({ routes: productionRoutes, ...options, limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, advances: 100_000, submissions: 100_000, ...(options.limits ?? {}) } });

export const get = (h: ServerHarness, path: string, headers: Record<string, string> = {}): Promise<ClientReply> => request(h.port, { path, headers });
export const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
export const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;

export interface Made {
  readonly id: string;
  readonly hostToken: string;
}

/** Creates a clock match through the service API (distinct request ids give distinct matches). */
export function makeMatch(h: ServerHarness, requestId = 'c-1', extra: Record<string, unknown> = {}): Made {
  const made = h.service.create({ credential: OPERATOR, body: creationBody(requestId, extra) });
  if (!made.ok) throw new Error(`creation failed: ${JSON.stringify(made.error)}`);
  return { id: made.reply.matchId, hostToken: made.reply.hostToken };
}

export const publicOf = (h: ServerHarness, id: string): PublicMatch => {
  const read = h.service.readPublicMatch(id);
  if (!read.ok) throw new Error('read failed');
  return read.reply;
};

const STEPS = ['phase-1-close', 'phase-2-close', 'application'] as const;

/** Performs `count` steps (3 per round) of the match by the operator credential through the service. */
export function advanceSteps(h: ServerHarness, id: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const shown = publicOf(h, id);
    const stage = shown.stage;
    if (stage === 'finished' || stage === 'halted') throw new Error(`the match is ${stage}`);
    const step = stage === 'phase-1' ? STEPS[0] : stage === 'phase-2' ? STEPS[1] : STEPS[2];
    const done = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: shown.appliedRounds + 1, step } });
    if (!done.ok) throw new Error(`advance failed: ${JSON.stringify(done.error)}`);
  }
}

/** The factions that own territories now. */
export const living = (h: ServerHarness, id: string): number[] => [...new Set(publicOf(h, id).state.owners.map(([, f]) => f))].sort((a, b) => a - b);

/** Runs `body` with a unique temporary directory removed after the asynchronous body ends (`withTempDir` is for synchronous bodies). */
export async function withTempDirAsync<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-http-'));
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
