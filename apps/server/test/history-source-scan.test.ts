import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { READ_SQL } from '../src/store/sqlite';

// Spec 024 NFR-118 (as 022 NFR-112): the community storage is read only by the history reads. A source scan pins the files that name the
// table, the statements that read it, the callers of the two history reads and the set of files that mention a community at all, so
// a new path to the key (a log, a public read, an event) fails here and gets reviewed before it ships.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const rel = (file: string): string => file.slice(SRC.length + 1).split('\\').join('/');
const source = (file: string): string => readFileSync(file, 'utf8');
const READS = /\b(FROM|JOIN)\s+communities\b/g;

describe('NFR-118 (source scan) the community storage is read only by the history reads', () => {
  it('NFR-118 (part: server storage) the table is named only by the schema and the sqlite store, and its reads are the two history statements and the duplicate check of the insert', () => {
    const naming = files(SRC).filter((f) => /\bcommunities\b/.test(source(f))).map(rel).sort();
    expect(naming).toStrictEqual(['store/schema.ts', 'store/sqlite.ts']);
    const sqlite = source(join(SRC, 'store', 'sqlite.ts'));
    const inHistory = [READ_SQL.historyAfter, READ_SQL.historyCount].map((sql) => [...sql.matchAll(READS)].length);
    expect(inHistory).toStrictEqual([1, 1]);
    // Each history statement names the table once (no second alias, no sub-select, no list of tables).
    expect([READ_SQL.historyAfter, READ_SQL.historyCount].map((sql) => [...sql.matchAll(/\bcommunities\b/g)].length)).toStrictEqual([1, 1]);
    // The one other read is the check that a match has no row yet, inside `insertCommunity`.
    expect([...sqlite.matchAll(READS)]).toHaveLength(3);
    expect(sqlite).toContain('SELECT 1 AS found FROM communities WHERE match_id = ?');
    for (const [name, sql] of Object.entries(READ_SQL)) if (name !== 'historyAfter' && name !== 'historyCount') expect(sql, name).not.toMatch(/communit/i);
  });

  it('NFR-118 (part: server) only the history method of the service calls the history reads, and the files that mention a community are the pinned ones', () => {
    const callers = files(SRC).filter((f) => /\.(historyAfter|historyCount)\(/.test(source(f))).map(rel).sort();
    // The service is the one caller; the fault seam only passes the two reads through.
    expect(callers).toStrictEqual(['service/matches.ts', 'store/faults.ts']);
    expect([...source(join(SRC, 'service', 'matches.ts')).matchAll(/store\.(historyAfter|historyCount)\(/g)]).toHaveLength(2);
    const mention = files(SRC).filter((f) => /communit/i.test(source(f))).map(rel).sort();
    expect(mention).toStrictEqual(['core/history.ts', 'core/policy.ts', 'http/body.ts', 'http/server.ts', 'service/matches.ts', 'store/faults.ts', 'store/schema.ts', 'store/sqlite.ts', 'store/store.ts']);
    // Not the log, the failure reporter, the shutdown or the stream and event modules.
    for (const file of files(SRC).map(rel).filter((f) => /^(http\/(log|shutdown|stream|router|limits)|core\/(events|timeline))/.test(f))) expect(source(join(SRC, file)), file).not.toMatch(/communit/i);
  });
});
