import { describe, expect, it } from 'vitest';
import ownSource from './traceability.test.ts?raw';

const testSources = import.meta.glob(
  ['../../*/test/**/*.test.ts', '../../../tools/*/test/**/*.test.ts', '../../../apps/*/test/**/*.test.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

const ciWorkflow = Object.values(
  import.meta.glob('../../../.github/workflows/ci.yml', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

// Matches it('t'), describe('t') and the second call of it.each([...])('t').
const TITLE = /(?:\b(?:it|test|describe)(?:\.\w+)*|\]\))\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const ID = /\b(?:FR|NFR)-\d+\b/g;

/** Requirement ids found in test/describe titles, excluding this file. */
export function tracedIds(sources: Record<string, string>): Set<string> {
  const found = new Set<string>();
  for (const [path, src] of Object.entries(sources)) {
    if (path.endsWith('traceability.test.ts')) continue;
    for (const m of src.matchAll(TITLE)) {
      for (const id of m[2]!.matchAll(ID)) found.add(id[0]);
    }
  }
  return found;
}

/** Ids retired by spec 002 (superseded by FR-60, FR-69 and FR-70): never allowed in a test title. */
const RETIRED = ['FR-6', 'FR-25'];

/** Ids traced by the test titles of this very file (the scan of other files skips it). */
const OWN_SOURCE = ownSource;
// Only real declarations (an it/describe call opening its line); code quoted inside a string is ignored.
const OWN_DECLARATIONS = OWN_SOURCE.split(/\r?\n/)
  .filter((l) => /^\s*(?:it|test|describe)(?:\.\w+)*\(/.test(l))
  .join('\n');
const TRACED_HERE = [...tracedIds({ 'x/own.test.ts': OWN_DECLARATIONS })];

// Id ranges of the specs: 001-003c, the viewer spec 004 (FR-132..FR-161, NFR-24..NFR-29)
// spec 005 (FR-167..FR-194, NFR-32..NFR-37), spec 006 (FR-195..FR-216, NFR-38..NFR-42)
// spec 007 (FR-217..FR-230, NFR-43..NFR-46) and spec 008 (FR-231..FR-315, NFR-47..NFR-57).
const FR_RANGES: readonly (readonly [number, number])[] = [[1, 315]];
const NFR_RANGES: readonly (readonly [number, number])[] = [[1, 57]];
const idsOf = (prefix: string, ranges: readonly (readonly [number, number])[]): string[] =>
  ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`));

const specIds = [...idsOf('FR', FR_RANGES), ...idsOf('NFR', NFR_RANGES)];
const expected = specIds.filter((id) => !RETIRED.includes(id));

/**
 * Ids of spec 008 whose tests are not written yet (pinned literal list). Each task of spec 008
 * removes the ids it traces in its own commit; M5 leaves this list empty.
 */
const PENDING_008: readonly string[] = [
  'FR-275', 'FR-276', 'FR-277', 'FR-278',
  'FR-303', 'FR-304', 'FR-305', 'FR-306', 'FR-307', 'FR-308', 'FR-309', 'FR-310',
  'FR-311',
  'NFR-56',
];

/** Ids of spec 008 already removed from PENDING_008 by the tasks that traced them (T2: FR-313; T3: NFR-51, NFR-55; T4: FR-312, NFR-48; T5: NFR-53; T7: FR-252; T2 of M2a: FR-301 (kinds and order); T3 of M2a: FR-233, FR-234, FR-296, FR-297; T4 of M2a: FR-253, FR-254, FR-257, FR-282 (NFR-47 part (b) also traced, part names in titles); T5 of M2a: FR-239, FR-249, FR-302, FR-314, NFR-50 (NFR-51 part server core also traced, part named in titles); T6 of M2a: FR-237, FR-240 (decision), FR-247, FR-255, FR-256, FR-258, FR-269 (FR-257 core part and NFR-48 core timeline also traced, parts named in titles); T7 of M2a: FR-244, FR-248 (letters a to c; the predictions-before-cutoff clause is traced by T8), FR-295 (letters b, c; letter a is traced by T8 in prediction titles); T8 of M2a: FR-261 to FR-268 (FR-295 letter a and the FR-248 cutoff clause also traced by T8 titles); T8: NFR-47 (part (e) only, the other parts stay open in later milestones: test titles of those milestones must say which part); M2b T2: FR-289 (part (c) only: the creation event; numbering by the store, replay, heartbeat and the stream stay open in later M2b/M3b tasks, whose titles must name the part) and FR-300 (part digests only: the memo key; the host token digest in the store and the constant-time comparison stay open in later tasks, whose titles must name the part); NFR-54 stays pending (its memo-key property is traced under FR-300 (digests)); M2b T3: FR-291 and FR-292 (part durability settings only: FR-292 (unavailable, retry) is completed in M2b' T3', whose titles must name the part); M2b T4: FR-270 (part storage only: the read over HTTP is M3a, whose titles must name the part) and FR-293 (the whole storage of recovery data; the use of it at restart is M2b' T4'); M2b T5: FR-231, FR-232, FR-235, FR-236, FR-238, FR-259 (commitment), FR-260 and NFR-54 (store; the logs part is M3a); M2b T6: FR-241, FR-242, FR-243, FR-245, FR-246, FR-288, FR-290, FR-315 and NFR-52 (parts: scoring of FR-241, FR-243 and FR-246 is M4; FR-288 and FR-290 streams are M3b; NFR-52 network is M3; FR-282 advance memo, FR-250, FR-251 and the timer recovery stay open in later tasks, whose titles must name the part); M2b' T2': FR-250 and FR-251 (the scoring part of FR-251 (c) is M4; the check at server start comes with start() in T3'; titles also name the ledger parts FR-241, FR-243, FR-245, FR-259, FR-266); M2b' T4': FR-294 (FR-249 across restarts, FR-315 restart after every step and NFR-48 lifecycle goldens also traced, parts named in titles); M2b' T6': NFR-57 (M2b part: states, records, steps, events, predictions and memo; the results part stays open to M4, whose titles must name the part); M3a T2: FR-279 (a), (b), (c), (e) (the leaderboard stale-cursor part (d) is M4 and the HTTP paging is M3a T8, whose titles must name the part); M3a T3: FR-283 (start refusal, namespaces, credential set and length; the Bearer reading is M3a T6, whose titles must name the part) and FR-299 (b) (values and defaults; the limiter parts (c) to (e) are M3a T6 and T7, the stream limits M3b, whose titles must name the part); M3a T5: FR-281 (a) to (d), (h), (j) through the service (the results reads (e) to (g) are M4, the stream (i) M3b and the HTTP routes M3a T7 and T8, whose titles must name the part); M3a T6: FR-284 (identity, namespace from the credential, player id) and FR-286 (policy; the headers on the wire are M3a T8, whose titles must name the part); M3a' T2': FR-280 and FR-298 (the command routes and the pipeline; the other ids they trace by part keep their open parts named in titles); M3a' T3': FR-285 (the public reads, the map files and CORS on the wire over HTTP; its event-stream part is M3b, whose titles must name the part); M3b' T2': FR-287 (the event order and content on the wire; its letter (d), the results event, is M4, whose titles must name the part); M3b' T4': NFR-49 (the pure part and the smoke run of the load procedure; the figures of the hand run are in the pull request); M4 T2: FR-274 (no streak bonus, no negative points; the pure scoring parts of FR-241, FR-243 and FR-246, the generation part of FR-279 (d) and the results rounds of FR-258 are traced by part-named titles); M4 T4: FR-271, FR-272, FR-273 (scoring of the victim, absorber and winner phases inside the step transaction; the reads of the results are M4', whose titles must name the part). */
const DONE_008: readonly string[] = ['FR-313', 'NFR-51', 'NFR-55', 'FR-312', 'NFR-48', 'NFR-53', 'FR-252', 'NFR-47', 'FR-301', 'FR-233', 'FR-234', 'FR-296', 'FR-297', 'FR-253', 'FR-254', 'FR-257', 'FR-282', 'FR-239', 'FR-249', 'FR-302', 'FR-314', 'NFR-50', 'FR-237', 'FR-240', 'FR-247', 'FR-255', 'FR-256', 'FR-258', 'FR-269', 'FR-244', 'FR-248', 'FR-295', 'FR-261', 'FR-262', 'FR-263', 'FR-264', 'FR-265', 'FR-266', 'FR-267', 'FR-268', 'FR-289', 'FR-300', 'FR-291', 'FR-292', 'FR-270', 'FR-293', 'FR-231', 'FR-232', 'FR-235', 'FR-236', 'FR-238', 'FR-259', 'FR-260', 'NFR-54', 'FR-241', 'FR-242', 'FR-243', 'FR-245', 'FR-246', 'FR-288', 'FR-290', 'FR-315', 'NFR-52', 'FR-250', 'FR-251', 'FR-294', 'NFR-57', 'FR-279', 'FR-283', 'FR-299', 'FR-281', 'FR-284', 'FR-286', 'FR-280', 'FR-298', 'FR-285', 'FR-287', 'NFR-49', 'FR-274', 'FR-271', 'FR-272', 'FR-273'];

describe('traceability', () => {
  it('the glob finds the test sources', () => {
    expect(Object.keys(testSources).length).toBeGreaterThanOrEqual(10);
  });

  it('NFR-19 the scanned sources include the viewer tests', () => {
    const viewer = Object.keys(testSources).filter((p) => p.includes('/apps/web/test/'));
    expect(viewer.length).toBeGreaterThanOrEqual(10);
  });

  it('NFR-19 the scanned sources include the builder tests', () => {
    const builder = Object.keys(testSources).filter((p) => p.includes('/tools/build-map/test/'));
    expect(builder.length).toBeGreaterThanOrEqual(1);
  });

  it('title extraction matches whole ids only and reads it.each titles', () => {
    const found = tracedIds({
      'x/a.test.ts': "it('FR-10 a', () => {}); it.each([[1]])('FR-12 %s', () => {});",
    });
    expect([...found].sort()).toStrictEqual(['FR-10', 'FR-12']);
  });

  it('NFR-13 the expected list holds the highest ids and excludes the retired ids', () => {
    expect(expected).toContain('FR-81');
    expect(expected).toContain('NFR-13');
    expect(expected).toContain('FR-60');
    expect(expected).toContain('NFR-6');
    for (const id of RETIRED) expect(expected).not.toContain(id);
  });

  it('NFR-13 NFR-19 the expected list ends at the last spec ids and excludes retired ids', () => {
    expect(FR_RANGES).toStrictEqual([[1, 315]]);
    expect(NFR_RANGES).toStrictEqual([[1, 57]]);
    const everything = new Set([...expected, ...RETIRED]);
    expect([...everything].sort()).toStrictEqual([...specIds].sort());
    expect(everything.size).toBe(372);
    expect(specIds.length - RETIRED.length).toBe(370);
    expect(expected.length).toBe(370);
    expect(expected).toContain('NFR-31');
    for (const id of ['FR-110', 'NFR-22', 'FR-104']) expect(expected).toContain(id);
    for (const id of ['FR-105', 'FR-126', 'NFR-14', 'NFR-23', 'FR-131', 'NFR-21']) {
      expect(expected).toContain(id);
    }
    for (const id of ['FR-132', 'FR-161', 'NFR-24', 'NFR-29', 'FR-166', 'NFR-31']) {
      expect(expected).toContain(id);
    }
    for (const id of ['FR-167', 'FR-194', 'NFR-32', 'NFR-37']) expect(expected).toContain(id);
    for (const id of ['FR-216', 'NFR-42', 'FR-230', 'NFR-46']) expect(specIds).toContain(id);
    for (const id of ['FR-231', 'FR-315', 'NFR-47', 'NFR-57']) {
      expect(specIds).toContain(id);
      expect(expected).toContain(id);
    }
    for (const id of ['FR-316', 'NFR-58']) {
      expect(specIds).not.toContain(id);
      expect(expected).not.toContain(id);
    }
    for (const id of ['FR-6', 'FR-25']) expect(expected).not.toContain(id);
  });

  it('NFR-35 the 34 ids of spec 005 are all expected and none is left out', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 28 }, (_, i) => `FR-${167 + i}`),
      ...Array.from({ length: 6 }, (_, i) => `NFR-${32 + i}`),
    ];
    expect(literal).toHaveLength(34);
    expect(literal[0]).toBe('FR-167');
    expect(literal).toContain('FR-194');
    expect(literal).toContain('NFR-37');
    for (const id of literal) expect(expected, id).toContain(id);
  });

  it('NFR-19 the expected list excludes only the retired ids', () => {
    // Independent computation with literal bounds.
    const all = [
      ...Array.from({ length: 315 }, (_, i) => `FR-${i + 1}`),
      ...Array.from({ length: 57 }, (_, i) => `NFR-${i + 1}`),
    ];
    expect(RETIRED).toStrictEqual(['FR-6', 'FR-25']);
    expect(all.filter((id) => !RETIRED.includes(id))).toHaveLength(370);
    expect(expected).toHaveLength(370);
    expect(expected).toStrictEqual(all.filter((id) => id !== 'FR-6' && id !== 'FR-25'));
    for (const id of ['FR-127', 'FR-131', 'NFR-16', 'NFR-17', 'NFR-21']) {
      expect(expected).toContain(id);
    }
  });

  it('NFR-13 extraction does not mistake ids sharing a retired prefix for retired ids', () => {
    const found = tracedIds({ 'x/a.test.ts': "it('NFR-6 FR-60 FR-69 a', () => {});" });
    expect([...found].sort()).toStrictEqual(['FR-60', 'FR-69', 'NFR-6']);
    expect(found.has('FR-6')).toBe(false);
  });

  it('NFR-13 a retired id in a test title is detected and none is in use', () => {
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-25 FR-6 a', () => {});" });
    expect(RETIRED.filter((id) => planted.has(id))).toStrictEqual(['FR-6', 'FR-25']);
    const used = tracedIds(testSources);
    expect(RETIRED.filter((id) => used.has(id))).toStrictEqual([]);
  });

  it('NFR-13 NFR-19 NFR-31 NFR-35 this file self-traces exactly the ids it verifies', () => {
    expect([...TRACED_HERE].sort()).toStrictEqual([
      'FR-55',
      'FR-56',
      'NFR-13',
      'NFR-19',
      'NFR-31',
      'NFR-35',
      'NFR-41',
      'NFR-44',
      'NFR-55',
    ]);
  });

  it('NFR-55 the 96 ids of spec 008 are pinned and every one is a spec id', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 85 }, (_, i) => `FR-${231 + i}`),
      ...Array.from({ length: 11 }, (_, i) => `NFR-${47 + i}`),
    ];
    expect(literal).toHaveLength(96);
    expect(literal[0]).toBe('FR-231');
    expect(literal).toContain('FR-315');
    expect(literal).toContain('NFR-57');
    expect(PENDING_008).toHaveLength(96 - DONE_008.length);
    // After M1: 8 ids traced (FR-252, FR-312, FR-313, NFR-47 part (e), NFR-48 seeds, NFR-51, NFR-53, NFR-55), 88 pending; M2a T2 adds FR-301 (9 / 87); M2a T3 adds FR-233, FR-234, FR-296, FR-297: 13 done, 83 pending; M2a T4 adds FR-253, FR-254, FR-257, FR-282: 17 done, 79 pending; M2a T5 adds FR-239, FR-249, FR-302, FR-314, NFR-50: 22 done, 74 pending; M2a T6 adds FR-237, FR-240, FR-247, FR-255, FR-256, FR-258, FR-269: 29 done, 67 pending; M2a T7 adds FR-244, FR-248, FR-295: 32 done, 64 pending; M2a T8 adds FR-261 to FR-268: 40 done, 56 pending; M2b T2 adds FR-289 (c) and FR-300 (digests): 42 done, 54 pending; M2b T3 adds FR-291 and FR-292: 44 done, 52 pending; M2b T4 adds FR-270 (storage) and FR-293 (FR-240 and FR-267 were already done in M2a): 46 done, 50 pending; M2b T5 adds FR-231, FR-232, FR-235, FR-236, FR-238, FR-259, FR-260 and NFR-54: 54 done, 42 pending; M2b T6 adds FR-241, FR-242, FR-243, FR-245, FR-246, FR-288, FR-290, FR-315 and NFR-52: 63 done, 33 pending; M2b T7 and T8 move no id; M2b' T2' adds FR-250 and FR-251: 65 done, 31 pending; M2b' T4' adds FR-294: 66 done, 30 pending; M2b' T6' adds NFR-57 (M2b part): 67 done, 29 pending; M3a T2 adds FR-279 (a), (b), (c), (e): 68 done, 28 pending; M3a T3 adds FR-283 and FR-299 (b): 70 done, 26 pending; M3a T5 adds FR-281 (a) to (d), (h), (j): 71 done, 25 pending; M3a T6 adds FR-284 and FR-286 (policy): 73 done, 23 pending; M3a' T2' adds FR-280 and FR-298: 75 done, 21 pending; M3a' T3' adds FR-285: 76 done, 20 pending.
    // M2a target (T10): 40 done / 56 pending; each M2a task moves its ids in its own commit.
    // M2b target (T8): 63 done / 33 pending. M2b' target (T7'): 67 done / 29 pending (plan section 17).
    // M2b' T1' starts at 63 / 33; T2' adds FR-250, FR-251 (65 / 31); T4' adds FR-294 (66 / 30); T6' adds NFR-57 (67 / 29).
    // M3a target (T7, after the C8 split): 73 done / 23 pending (plan section 18.10). M3a T1 starts at 67 / 29; T2 adds FR-279 (68 / 28);
    // T3 adds FR-283, FR-299 (70 / 26); T4 moves none; T5 adds FR-281 (71 / 25); T6 adds FR-284, FR-286 (73 / 23); T7 moves none.
    // M3a' target (T5'): 76 done / 20 pending. T1' starts at 73 / 23; T2' adds FR-280, FR-298 (75 / 21); T3' adds FR-285 (76 / 20);
    // T4' moves none; T5' pins the 3 M3a' ids (FR-280, FR-285, FR-298) as done in the closing-state test.
    // M3b target (T6): 76 done / 20 pending (plan section 19.10): M3b moves no id (it completes parts of done ids).
    // M3b' target (T5'): 78 done / 18 pending (plan section 19.10). T1' starts at 76 / 20; T2' adds FR-287 (77 / 19, its
    // letter (d) results event goes to M4); T3' moves none; T4' adds NFR-49 (78 / 18); T5' pins both as done.
    // M4 target (T5): 82 done / 14 pending (plan section 20.10). T1 starts at 78 / 18; T2 adds FR-274 (79 / 17); T3 moves none;
    // T4 adds FR-271, FR-272, FR-273 (82 / 14); T5 pins the closing state.
    // M4' target (T6'): 86 done / 10 pending. T1' starts at 82 / 14; T2' moves none; T3' adds four ids (86 / 10);
    // T4' and T5' move none; T6' pins the closing state.
    expect(DONE_008).toHaveLength(82);
    expect(PENDING_008).toHaveLength(14);
    expect(new Set([...PENDING_008, ...DONE_008]).size).toBe(96);
    expect([...PENDING_008, ...DONE_008].sort()).toStrictEqual([...literal].sort());
    for (const id of PENDING_008) expect(expected, id).toContain(id);
  });

  it("NFR-55 M4 closing state, 82 ids done and 14 pending: the M2b to M3a' ids done, the event order, the load procedure and the scoring done, the later ids pending", () => {
    // M4 closing state (plan sections 11 and 13): asserted explicitly. M3a moved six ids
    // (T2: FR-279; T3: FR-283, FR-299; T5: FR-281; T6: FR-284, FR-286); M3a' T2' moved FR-280 and FR-298; T3' moved FR-285.
    // M3b moved no id: it completed parts of done ids (event encoders, stream framing, stream limits, the replay read, the hub,
    // the stream route). M3b' T2' moves FR-287 (letter (d), the results event, is M4); T4' moves NFR-49.
    expect(DONE_008).toHaveLength(82);
    expect(PENDING_008).toHaveLength(14);
    expect(DONE_008.length + PENDING_008.length).toBe(96);
    // The ids M2b closed (plan section 17.3), a literal list independent of DONE_008.
    const closedByM2b = [
      'FR-231', 'FR-232', 'FR-235', 'FR-236', 'FR-238', 'FR-241', 'FR-242', 'FR-243', 'FR-245', 'FR-246',
      'FR-259', 'FR-260', 'FR-270', 'FR-288', 'FR-289', 'FR-290', 'FR-291', 'FR-292', 'FR-293', 'FR-300',
      'FR-315', 'NFR-52', 'NFR-54',
    ];
    expect(closedByM2b).toHaveLength(23);
    for (const id of closedByM2b) expect(DONE_008, id).toContain(id);
    // M2b' closed four ids (67 done, 29 pending): T2' FR-250 and FR-251, T4' FR-294, T6' NFR-57 (its results part stays open to M4).
    const closedByM2b2 = ['FR-250', 'FR-251', 'FR-294', 'NFR-57'];
    expect(closedByM2b2).toHaveLength(4);
    for (const id of closedByM2b2) expect(DONE_008, id).toContain(id);
    // M2b and M2b' together closed 27 ids on top of the 40 of M1 and M2a.
    expect(new Set([...closedByM2b, ...closedByM2b2]).size).toBe(27);
    // M3a closed six ids (plan section 18.10, after the C8 split), a literal list independent of DONE_008.
    const closedByM3a = ['FR-279', 'FR-281', 'FR-283', 'FR-284', 'FR-286', 'FR-299'];
    expect(new Set(closedByM3a).size).toBe(6);
    for (const id of closedByM3a) expect(DONE_008, id).toContain(id);
    // Up to M3a: the 40 ids of M1 and M2a, 27 of M2b and M2b', 6 of M3a, all distinct and all done.
    const closedSinceM2b = new Set([...closedByM2b, ...closedByM2b2, ...closedByM3a]);
    expect(closedSinceM2b.size).toBe(33);
    // (49 outside this set now: the 40 of M1 and M2a plus FR-280, FR-285 and FR-298 of M3a', FR-287 and NFR-49 of M3b', and FR-271 to FR-274 of M4, asserted below.)
    expect(DONE_008.filter((id) => !closedSinceM2b.has(id))).toHaveLength(49);
    // M3a' closed three ids: T2' FR-280 and FR-298, T3' FR-285.
    const closedByM3a2 = ['FR-280', 'FR-285', 'FR-298'];
    expect(new Set(closedByM3a2).size).toBe(3);
    for (const id of closedByM3a2) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
      expect(closedSinceM2b.has(id), id).toBe(false);
    }
    // The 6 M3a ids and the 3 M3a' ids are the 9 ids of the HTTP milestones: all done, none pending.
    const closedByHttp = [...closedByM3a, ...closedByM3a2];
    expect(new Set(closedByHttp).size).toBe(9);
    for (const id of closedByHttp) expect(PENDING_008, id).not.toContain(id);
    // M4 closed four ids (82 done, 14 pending): T2 FR-274, T4 FR-271, FR-272, FR-273; a literal list independent of DONE_008.
    const closedByM4 = ['FR-271', 'FR-272', 'FR-273', 'FR-274'];
    expect(new Set(closedByM4).size).toBe(4);
    for (const id of closedByM4) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M3b' closed FR-287 (T2') and NFR-49 (T4'): done, not pending.
    for (const id of ['FR-287', 'NFR-49']) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M4 moved FR-271 to FR-274; M4' and M5 are still pending (a literal list of every one of the 14).
    const laterIds = [
      'FR-275', 'FR-276', 'FR-277', 'FR-278',
      'FR-303', 'FR-304', 'FR-305', 'FR-306', 'FR-307', 'FR-308', 'FR-309', 'FR-310', 'FR-311',
      'NFR-56',
    ];
    expect(laterIds).toHaveLength(14);
    for (const id of laterIds) expect(DONE_008, id).not.toContain(id);
    // Exactly the later ids are pending, nothing else.
    expect(new Set(laterIds).size).toBe(14);
    expect([...PENDING_008].sort()).toStrictEqual([...laterIds].sort());
  });

  it('NFR-55 no pending id of spec 008 is already traced by a test title', () => {
    const used = tracedIds(testSources);
    const traced = PENDING_008.filter((id) => used.has(id));
    expect(traced, `remove from PENDING_008: ${traced.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-55 the pending-id check sees a pending id planted in a test title', () => {
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-303 a', () => {});" });
    expect(PENDING_008.filter((id) => planted.has(id))).toStrictEqual(['FR-303']);
  });

  it("NFR-55 the pending-id check sees a pending M4' id planted in a dummy title", () => {
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-275 a', () => {});" });
    expect(PENDING_008.filter((id) => planted.has(id))).toStrictEqual(['FR-275']);
  });

  it('NFR-44 the 18 ids of spec 007 are all expected', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 14 }, (_, i) => `FR-${217 + i}`),
      ...Array.from({ length: 4 }, (_, i) => `NFR-${43 + i}`),
    ];
    expect(literal).toHaveLength(18);
    expect(literal[0]).toBe('FR-217');
    expect(literal).toContain('FR-230');
    expect(literal).toContain('NFR-46');
    for (const id of literal) {
      expect(specIds, id).toContain(id);
      expect(expected, id).toContain(id);
    }
  });

  it('NFR-41 the 27 ids of spec 006 are all expected', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 22 }, (_, i) => `FR-${195 + i}`),
      ...Array.from({ length: 5 }, (_, i) => `NFR-${38 + i}`),
    ];
    expect(literal).toHaveLength(27);
    expect(literal[0]).toBe('FR-195');
    expect(literal).toContain('FR-216');
    expect(literal).toContain('NFR-42');
    for (const id of literal) {
      expect(specIds, id).toContain(id);
      expect(expected, id).toContain(id);
    }
  });

  it('NFR-31 the ids of spec 003c are all expected', () => {
    for (const id of ['FR-162', 'FR-163', 'FR-164', 'FR-165', 'FR-166', 'NFR-30', 'NFR-31']) {
      expect(expected).toContain(id);
    }
  });

  it('NFR-13 NFR-19 every expected requirement id appears in a test name', () => {
    const found = tracedIds(testSources);
    for (const id of TRACED_HERE) found.add(id);
    const missing = expected.filter((id) => !PENDING_008.includes(id) && !found.has(id));
    expect(missing, `ids without a test name: ${missing.join(', ')}`).toStrictEqual([]);
  });

  // FR-55/FR-56 are about the hosted CI. A unit test cannot run GitHub; it only
  // checks the workflow configuration. Real proof is the CI demonstration PRs.
  it('FR-55 workflow runs typecheck and tests on pull requests and pushes to main and rewrite', () => {
    expect(ciWorkflow).toBeDefined();
    expect(ciWorkflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main, rewrite\]/);
    expect(ciWorkflow).toMatch(/push:\s*\n\s*branches:\s*\[main, rewrite\]/);
    expect(ciWorkflow).toMatch(/run:\s*npm run typecheck/);
    expect(ciWorkflow).toMatch(/run:\s*npm test/);
  });

  it('FR-56 workflow never masks a failing step', () => {
    expect(ciWorkflow).not.toMatch(/continue-on-error/);
    expect(ciWorkflow).not.toMatch(/\|\|\s*(true|exit 0)/);
  });
});
