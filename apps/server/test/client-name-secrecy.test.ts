import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllServers } from './helpers/server-harness';
import { OTHER_CREDENTIAL, begin, finish, get, post, predict } from './helpers/client-names';
import type { Rig } from './helpers/client-names';

// Spec 022 NFR-112, NFR-113, FR-534, FR-535: a planted display name appears in no reply, event or log line before its player is
// scored, and afterwards only in the reads of FR-533; nothing about who predicted shows before scoring.

afterEach(closeAllServers);

const PLANTED = 'Qxz Planted Name';
const REFUSED = 'Qxz Refused Name';

interface Seen {
  readonly rig: Rig;
  readonly before: string[];
  readonly after: Map<string, string>;
}

const FOUR = (id: string): string[] => [`/matches/${id}/leaderboard`, `/matches/${id}/results/1/1`, `/matches/${id}/results/1/1/winners`, `/matches/${id}/players/web:p1/results`];
const OTHERS = (id: string): string[] => [`/matches/${id}`, '/matches', `/matches/${id}/players`, `/matches/${id}/records`, `/matches/${id}/states/0`, '/config', `/matches/${id}/predictions`];

const script = async (): Promise<Seen> => {
  const rig = await begin(true);
  const id = rig.matchId;
  const before: string[] = [];
  const keep = (text: string): void => void before.push(text);
  // Writes before scoring: the owner's named prediction, a refused named one, a refused join, a refused player-style name.
  keep((await predict(rig, 'p1', { name: PLANTED })).text);
  keep((await predict(rig, 'p9', { name: REFUSED }, OTHER_CREDENTIAL)).text);
  keep((await post(rig.h, `/matches/${id}/players`, { name: REFUSED, requestId: 'j-1' })).text);
  keep((await predict(rig, 'p1', { name: 'x'.repeat(25) })).text);
  // Reads before scoring, with the probe of the planted id and of an id that never predicted.
  for (const path of [...FOUR(id), ...OTHERS(id), `/matches/${id}/players/web:never/results`]) keep((await get(rig.h, path)).text);
  keep(JSON.stringify(rig.h.service.eventsAfter(id, 0)));
  const probe = await get(rig.h, `/matches/${id}/players/web:p1/results`);
  const never = await get(rig.h, `/matches/${id}/players/web:never/results`);
  expect(probe.text.replace('web:p1', 'web:never')).toBe(never.text);
  finish(rig);
  const after = new Map<string, string>();
  for (const path of [...FOUR(id), ...OTHERS(id)]) after.set(path, (await get(rig.h, path)).text);
  after.set('events', JSON.stringify(rig.h.service.eventsAfter(id, 0)));
  return { rig, before, after };
};

describe('NFR-112 FR-534 FR-535 a display name stays secret until its player is scored', () => {
  it('no reply, event or log line before scoring holds the name, and no read shows that the member predicted', async () => {
    const run = await script();
    const everything = `${run.before.join('\n')}\n${JSON.stringify(run.rig.h.logs)}`;
    expect(everything).not.toContain(PLANTED);
    expect(everything).not.toContain(REFUSED);
    expect(everything).not.toContain('Planted');
    // the roster, the match view and the events say nothing of the member
    expect(run.before.join('\n')).not.toContain('player-joined');
  });

  it('after scoring only the leaderboard, the phase results, the winners and the own-player read hold the name; no log line ever does', async () => {
    const run = await script();
    const id = run.rig.matchId;
    for (const path of FOUR(id)) {
      const text = run.after.get(path)!;
      if (path.endsWith('/winners')) continue; // only the right guess is listed: the single member may have been wrong
      expect(text, path).toContain(PLANTED);
    }
    for (const path of OTHERS(id)) expect(run.after.get(path)!, path).not.toContain(PLANTED);
    expect(run.after.get('events')).not.toContain(PLANTED);
    expect(JSON.stringify(run.rig.h.logs)).not.toContain(PLANTED);
    expect(JSON.stringify(run.rig.h.logs)).not.toContain(REFUSED);
  });

  it('a refused member (another client) leaves no trace even after scoring', async () => {
    const run = await script();
    const all = [...run.after.values()].join('\n');
    expect(all).not.toContain(REFUSED);
    expect(all).not.toContain('web:p9');
    expect(all).not.toContain('tg:p9');
  });
});

describe('NFR-112 NFR-113 the sources reach the names in one way only', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.name.endsWith('.ts')) files.push(join(d, entry.name));
    }
  };
  walk(src);
  const rel = (f: string): string => f.slice(src.length + 1).replaceAll('\\', '/');
  const textOf = (f: string): string => readFileSync(f, 'utf8');

  it('NFR-112 client_names is named only by the schema and the store adapter', () => {
    expect(files.filter((f) => /client_names/.test(textOf(f))).map(rel).sort()).toStrictEqual(['store/schema.ts', 'store/sqlite.ts']);
  });

  it('NFR-112 clientNames is read only through the one helper of the service, which only three service reads call', () => {
    expect(files.filter((f) => /\bclientNames\(/.test(textOf(f))).map(rel).sort()).toStrictEqual(['service/matches.ts', 'store/faults.ts', 'store/sqlite.ts', 'store/store.ts']);
    const service = textOf(join(src, 'service', 'matches.ts'));
    expect(service.match(/store\.clientNames\(/g)).toHaveLength(1);
    // the helper is called by exactly three service reads (phase results, own-player read, leaderboard)
    expect(service.match(/\bnamesOf\(/g)).toHaveLength(3);
    for (const reader of ['phaseResults', 'playerResults', 'leaderboard']) {
      const at = service.indexOf(`    ${reader}(`);
      expect(at, reader).toBeGreaterThan(0);
      const body = service.slice(at, service.indexOf('\n    },\n', at));
      expect(body, reader).toMatch(/\bnamesOf\(/);
    }
  });

  it('NFR-113 no log call, error text or metric names a name', () => {
    for (const f of files) {
      const text = textOf(f);
      if (/\b(putClientName|clientNames|namesOf)\b/.test(text)) expect(text, rel(f)).not.toMatch(/\b(log|logger|console)\b\s*[.(][^\n]*\bname\b/);
    }
  });
});
