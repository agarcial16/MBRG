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
// spec 007 (FR-217..FR-230, NFR-43..NFR-46), spec 008 (FR-231..FR-315, NFR-47..NFR-57)
// spec 009 (FR-316..FR-355, NFR-58..NFR-64), spec 010 (FR-356..FR-368, NFR-65..NFR-71)
// and spec 011 (FR-369..FR-392, NFR-72..NFR-76).
const FR_RANGES: readonly (readonly [number, number])[] = [[1, 392]];
const NFR_RANGES: readonly (readonly [number, number])[] = [[1, 76]];
const idsOf = (prefix: string, ranges: readonly (readonly [number, number])[]): string[] =>
  ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`));

const specIds = [...idsOf('FR', FR_RANGES), ...idsOf('NFR', NFR_RANGES)];
const expected = specIds.filter((id) => !RETIRED.includes(id));

/**
 * Ids of spec 008 whose tests are not written yet (pinned literal list). Each task of spec 008
 * removes the ids it traces in its own commit; M5' leaves this list empty.
 */
const PENDING_008: readonly string[] = [
];

/** Ids of spec 008 already removed from PENDING_008 by the tasks that traced them (T2: FR-313; T3: NFR-51, NFR-55; T4: FR-312, NFR-48; T5: NFR-53; T7: FR-252; T2 of M2a: FR-301 (kinds and order); T3 of M2a: FR-233, FR-234, FR-296, FR-297; T4 of M2a: FR-253, FR-254, FR-257, FR-282 (NFR-47 part (b) also traced, part names in titles); T5 of M2a: FR-239, FR-249, FR-302, FR-314, NFR-50 (NFR-51 part server core also traced, part named in titles); T6 of M2a: FR-237, FR-240 (decision), FR-247, FR-255, FR-256, FR-258, FR-269 (FR-257 core part and NFR-48 core timeline also traced, parts named in titles); T7 of M2a: FR-244, FR-248 (letters a to c; the predictions-before-cutoff clause is traced by T8), FR-295 (letters b, c; letter a is traced by T8 in prediction titles); T8 of M2a: FR-261 to FR-268 (FR-295 letter a and the FR-248 cutoff clause also traced by T8 titles); T8: NFR-47 (part (e) only, the other parts stay open in later milestones: test titles of those milestones must say which part); M2b T2: FR-289 (part (c) only: the creation event; numbering by the store, replay, heartbeat and the stream stay open in later M2b/M3b tasks, whose titles must name the part) and FR-300 (part digests only: the memo key; the host token digest in the store and the constant-time comparison stay open in later tasks, whose titles must name the part); NFR-54 stays pending (its memo-key property is traced under FR-300 (digests)); M2b T3: FR-291 and FR-292 (part durability settings only: FR-292 (unavailable, retry) is completed in M2b' T3', whose titles must name the part); M2b T4: FR-270 (part storage only: the read over HTTP is M3a, whose titles must name the part) and FR-293 (the whole storage of recovery data; the use of it at restart is M2b' T4'); M2b T5: FR-231, FR-232, FR-235, FR-236, FR-238, FR-259 (commitment), FR-260 and NFR-54 (store; the logs part is M3a); M2b T6: FR-241, FR-242, FR-243, FR-245, FR-246, FR-288, FR-290, FR-315 and NFR-52 (parts: scoring of FR-241, FR-243 and FR-246 is M4; FR-288 and FR-290 streams are M3b; NFR-52 network is M3; FR-282 advance memo, FR-250, FR-251 and the timer recovery stay open in later tasks, whose titles must name the part); M2b' T2': FR-250 and FR-251 (the scoring part of FR-251 (c) is M4; the check at server start comes with start() in T3'; titles also name the ledger parts FR-241, FR-243, FR-245, FR-259, FR-266); M2b' T4': FR-294 (FR-249 across restarts, FR-315 restart after every step and NFR-48 lifecycle goldens also traced, parts named in titles); M2b' T6': NFR-57 (M2b part: states, records, steps, events, predictions and memo; the results part stays open to M4, whose titles must name the part); M3a T2: FR-279 (a), (b), (c), (e) (the leaderboard stale-cursor part (d) is M4 and the HTTP paging is M3a T8, whose titles must name the part); M3a T3: FR-283 (start refusal, namespaces, credential set and length; the Bearer reading is M3a T6, whose titles must name the part) and FR-299 (b) (values and defaults; the limiter parts (c) to (e) are M3a T6 and T7, the stream limits M3b, whose titles must name the part); M3a T5: FR-281 (a) to (d), (h), (j) through the service (the results reads (e) to (g) are M4, the stream (i) M3b and the HTTP routes M3a T7 and T8, whose titles must name the part); M3a T6: FR-284 (identity, namespace from the credential, player id) and FR-286 (policy; the headers on the wire are M3a T8, whose titles must name the part); M3a' T2': FR-280 and FR-298 (the command routes and the pipeline; the other ids they trace by part keep their open parts named in titles); M3a' T3': FR-285 (the public reads, the map files and CORS on the wire over HTTP; its event-stream part is M3b, whose titles must name the part); M3b' T2': FR-287 (the event order and content on the wire; its letter (d), the results event, is M4, whose titles must name the part); M3b' T4': NFR-49 (the pure part and the smoke run of the load procedure; the figures of the hand run are in the pull request); M4 T2: FR-274 (no streak bonus, no negative points; the pure scoring parts of FR-241, FR-243 and FR-246, the generation part of FR-279 (d) and the results rounds of FR-258 are traced by part-named titles); M4 T4: FR-271, FR-272, FR-273 (scoring of the victim, absorber and winner phases inside the step transaction); M4' T3': FR-275, FR-276, FR-277, FR-278 (the three results reads through the store and the service). M5 T3: FR-305, FR-306, NFR-56 (the live address, the scene choice and the panel texts). M5 T4: FR-303, FR-304 (the live model: rounds held, events, requests only for applied rounds). M5b T5: FR-307 (the connection policy: retries, reconnection, unknown match, closing). M5b T6b: FR-308 (the map digest check and the fail-closed transport). M5' T4': FR-309, FR-311 (the production build keeps the debug scene, the test client and the credential out). M5' T5': FR-310 (the web test client). */
const DONE_008: readonly string[] = ['FR-313', 'NFR-51', 'NFR-55', 'FR-312', 'NFR-48', 'NFR-53', 'FR-252', 'NFR-47', 'FR-301', 'FR-233', 'FR-234', 'FR-296', 'FR-297', 'FR-253', 'FR-254', 'FR-257', 'FR-282', 'FR-239', 'FR-249', 'FR-302', 'FR-314', 'NFR-50', 'FR-237', 'FR-240', 'FR-247', 'FR-255', 'FR-256', 'FR-258', 'FR-269', 'FR-244', 'FR-248', 'FR-295', 'FR-261', 'FR-262', 'FR-263', 'FR-264', 'FR-265', 'FR-266', 'FR-267', 'FR-268', 'FR-289', 'FR-300', 'FR-291', 'FR-292', 'FR-270', 'FR-293', 'FR-231', 'FR-232', 'FR-235', 'FR-236', 'FR-238', 'FR-259', 'FR-260', 'NFR-54', 'FR-241', 'FR-242', 'FR-243', 'FR-245', 'FR-246', 'FR-288', 'FR-290', 'FR-315', 'NFR-52', 'FR-250', 'FR-251', 'FR-294', 'NFR-57', 'FR-279', 'FR-283', 'FR-299', 'FR-281', 'FR-284', 'FR-286', 'FR-280', 'FR-298', 'FR-285', 'FR-287', 'NFR-49', 'FR-274', 'FR-271', 'FR-272', 'FR-273', 'FR-275', 'FR-276', 'FR-277', 'FR-278', 'FR-305', 'FR-306', 'NFR-56', 'FR-303', 'FR-304', 'FR-307', 'FR-308', 'FR-309', 'FR-311', 'FR-310'];

/**
 * Ids of spec 009 whose tests are not written yet (pinned literal list of its 47 ids). Each task of
 * spec 009 removes the ids it traces in its own commit; the last task of M5 leaves this list empty.
 */
const PENDING_009: readonly string[] = [];

/** Ids of spec 009 already removed from PENDING_009 by the tasks that traced them (M1 T2: FR-318, FR-321, FR-322; M1 T3: FR-323, FR-324, FR-325, FR-343, FR-346; M1 T4: FR-331, FR-332, FR-334, FR-335, FR-348; M1 T5: FR-327, FR-328, FR-329, FR-333, FR-347, FR-353, FR-354; M2 T2: FR-316, FR-319, FR-320, FR-336, FR-338, FR-349; M2 T3: FR-342, FR-344; M2 T4: NFR-59, NFR-60; M3 T2: FR-317, FR-339, FR-340, NFR-61; M3 T3: FR-337, FR-345, FR-350; M3 T4: FR-330, NFR-64; M3 T5: FR-351, FR-352; M4 T2: FR-326, FR-355; M4 T4: FR-341; M4 T5: NFR-58, NFR-62; M5 T4: NFR-63). */
const DONE_009: readonly string[] = ['FR-318', 'FR-321', 'FR-322', 'FR-323', 'FR-324', 'FR-325', 'FR-343', 'FR-346', 'FR-331', 'FR-332', 'FR-334', 'FR-335', 'FR-348', 'FR-327', 'FR-328', 'FR-329', 'FR-333', 'FR-347', 'FR-353', 'FR-354', 'FR-316', 'FR-319', 'FR-320', 'FR-336', 'FR-338', 'FR-349', 'FR-342', 'FR-344', 'NFR-59', 'NFR-60', 'FR-317', 'FR-339', 'FR-340', 'NFR-61', 'FR-337', 'FR-345', 'FR-350', 'FR-330', 'NFR-64', 'FR-351', 'FR-352', 'FR-326', 'FR-355', 'FR-341', 'NFR-58', 'NFR-62', 'NFR-63'];

/**
 * Ids of spec 010 (interface revamp; FR-356..FR-368, NFR-65..NFR-71) whose tests are not written or not complete yet (pinned literal
 * list). Each task of spec 010 removes the ids it closes in its own commit; the last task leaves this list empty.
 */
const PENDING_010: readonly string[] = ['NFR-68', 'NFR-69', 'NFR-71'];

/** Ids of spec 010 already closed (milestone a: layout, top bar, states, tokens and fonts, contrast, keyboard and motion, strings; milestone b: minimap, chronicle, factions, archive, replay band, track; milestone c: terra incognita, start screen). */
const DONE_010: readonly string[] = ['FR-356', 'FR-357', 'FR-358', 'FR-359', 'FR-360', 'FR-361', 'FR-362', 'FR-363', 'FR-364', 'FR-365', 'FR-366', 'FR-367', 'FR-368', 'NFR-65', 'NFR-66', 'NFR-67', 'NFR-70'];

/**
 * Ids of spec 011 (playable matches; FR-369..FR-392, NFR-72..NFR-76) whose tests are not written yet
 * (pinned literal list of its 29 ids). Each task of spec 011 moves the ids it closes from here to
 * DONE_011 in its own commit; the last task leaves this list empty.
 */
const PENDING_011: readonly string[] = [
  'FR-369', 'FR-370', 'FR-371', 'FR-372', 'FR-373', 'FR-374', 'FR-375', 'FR-376', 'FR-377', 'FR-378',
  'FR-379', 'FR-380', 'FR-381', 'FR-382', 'FR-383', 'FR-384', 'FR-385', 'FR-386', 'FR-388',
  'FR-389', 'FR-390', 'FR-391', 'FR-392', 'NFR-72', 'NFR-73', 'NFR-74', 'NFR-75', 'NFR-76',
];

/** Ids of spec 011 already closed (M1 T4: FR-387, a forced absorber is not predicted and does not score). */
const DONE_011: readonly string[] = ['FR-387'];

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
    expect(FR_RANGES).toStrictEqual([[1, 392]]);
    expect(NFR_RANGES).toStrictEqual([[1, 76]]);
    const everything = new Set([...expected, ...RETIRED]);
    expect([...everything].sort()).toStrictEqual([...specIds].sort());
    expect(everything.size).toBe(468);
    expect(specIds.length - RETIRED.length).toBe(466);
    expect(expected.length).toBe(466);
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
    for (const id of ['FR-316', 'FR-355', 'NFR-58', 'NFR-64']) {
      expect(specIds).toContain(id);
      expect(expected).toContain(id);
    }
    for (const id of ['FR-369', 'FR-392', 'NFR-72', 'NFR-76']) {
      expect(specIds).toContain(id);
      expect(expected).toContain(id);
    }
    for (const id of ['FR-393', 'NFR-77']) {
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
      ...Array.from({ length: 392 }, (_, i) => `FR-${i + 1}`),
      ...Array.from({ length: 76 }, (_, i) => `NFR-${i + 1}`),
    ];
    expect(RETIRED).toStrictEqual(['FR-6', 'FR-25']);
    expect(all.filter((id) => !RETIRED.includes(id))).toHaveLength(466);
    expect(expected).toHaveLength(466);
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
    // M5 target (T4c): 91 done / 5 pending (plan section 21.16). T1 and T2 start at 86 / 10 and move none; T3 adds FR-305, FR-306,
    // NFR-56 (89 / 7); T4 adds FR-303, FR-304 (91 / 5); T4c pins the closing state.
    // M5b target (T7): 93 done / 3 pending. T5 adds FR-307 (92 / 4); T6a moves none; T6b adds FR-308 (93 / 3); T7 pins the closing state.
    // M5' target (T7'): 96 done / 0 pending. T1' starts at 93 / 3; T2' and T3' move none; T4' adds FR-309, FR-311 (95 / 1);
    // T5' adds FR-310 (96 / 0); T6' moves none; T7' pins the empty pending set.
    expect(DONE_008).toHaveLength(96);
    expect(PENDING_008).toHaveLength(0);
    expect(new Set([...PENDING_008, ...DONE_008]).size).toBe(96);
    expect([...PENDING_008, ...DONE_008].sort()).toStrictEqual([...literal].sort());
    for (const id of PENDING_008) expect(expected, id).toContain(id);
  });

  it("NFR-55 M5' closing state, 96 ids done and none pending: every id of spec 008 is done", () => {
    // M4 closing state (plan sections 11 and 13): asserted explicitly. M3a moved six ids
    // (T2: FR-279; T3: FR-283, FR-299; T5: FR-281; T6: FR-284, FR-286); M3a' T2' moved FR-280 and FR-298; T3' moved FR-285.
    // M3b moved no id: it completed parts of done ids (event encoders, stream framing, stream limits, the replay read, the hub,
    // the stream route). M3b' T2' moves FR-287 (letter (d), the results event, is M4); T4' moves NFR-49.
    expect(DONE_008).toHaveLength(96);
    expect(PENDING_008).toHaveLength(0);
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
    // (63 outside this set now: the 40 of M1 and M2a plus FR-280, FR-285 and FR-298 of M3a', FR-287 and NFR-49 of M3b', FR-271 to FR-274 of M4, FR-275 to FR-278 of M4', FR-303 to FR-306 and NFR-56 of M5 and FR-307 and FR-308 of M5b and FR-309, FR-310 and FR-311 of M5', asserted below.)
    expect(DONE_008.filter((id) => !closedSinceM2b.has(id))).toHaveLength(63);
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
    // M4' closed four ids (86 done, 10 pending): FR-275 to FR-278, the three results reads (T3'); with FR-271 to FR-274 of M4 the
    // eight scoring and results ids are all done. A literal list independent of DONE_008.
    const closedByM4b = ['FR-275', 'FR-276', 'FR-277', 'FR-278'];
    expect(new Set(closedByM4b).size).toBe(4);
    for (const id of closedByM4b) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    for (const id of [...closedByM4, ...closedByM4b]) expect(DONE_008, id).toContain(id);
    expect(new Set([...closedByM4, ...closedByM4b]).size).toBe(8);
    // M3b' closed FR-287 (T2') and NFR-49 (T4'): done, not pending.
    for (const id of ['FR-287', 'NFR-49']) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M5 closed five ids (91 done, 5 pending): T3 FR-305, FR-306, NFR-56; T4 FR-303, FR-304; a literal list independent of DONE_008.
    const closedByM5 = ['FR-303', 'FR-304', 'FR-305', 'FR-306', 'NFR-56'];
    expect(new Set(closedByM5).size).toBe(5);
    for (const id of closedByM5) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M5b closed two ids (93 done, 3 pending): T5 FR-307 (connection policy), T6b FR-308 (transport and map digest); a literal list independent of DONE_008.
    const closedByM5b = ['FR-307', 'FR-308'];
    expect(new Set(closedByM5b).size).toBe(2);
    for (const id of closedByM5b) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M5' T4' closed two ids (95 done, 1 pending): the production build check; a literal list independent of DONE_008.
    const closedByBuildCheck = ['FR-309', 'FR-311'];
    expect(new Set(closedByBuildCheck).size).toBe(2);
    for (const id of closedByBuildCheck) {
      expect(DONE_008, id).toContain(id);
      expect(PENDING_008, id).not.toContain(id);
    }
    // M5' closed FR-309 and FR-311 (T4') and FR-310 (T5'): the pending set is empty and every id of spec 008 is done.
    const closedByM5p = ['FR-309', 'FR-310', 'FR-311'];
    expect(new Set(closedByM5p).size).toBe(3);
    for (const id of closedByM5p) expect(DONE_008, id).toContain(id);
    expect(PENDING_008).toStrictEqual([]);
  });

  it('NFR-55 no pending id of spec 008 is already traced by a test title', () => {
    const used = tracedIds(testSources);
    const traced = PENDING_008.filter((id) => used.has(id));
    expect(traced, `remove from PENDING_008: ${traced.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-55 the pending set of spec 008 is empty: every id has a test title', () => {
    expect(PENDING_008).toStrictEqual([]);
    expect(DONE_008).toHaveLength(96);
  });

  it('NFR-55 the pending-id check sees a pending id planted in a test title, over a synthetic list', () => {
    const synthetic = ['FR-901', 'FR-902'];
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-902 a', () => {});" });
    expect(synthetic.filter((id) => planted.has(id))).toStrictEqual(['FR-902']);
    expect(synthetic.filter((id) => tracedIds({ 'x/a.test.ts': "it('FR-9020 a', () => {});" }).has(id))).toStrictEqual([]);
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
    const missing = expected.filter(
      (id) =>
        !PENDING_008.includes(id) &&
        !PENDING_009.includes(id) &&
        !PENDING_010.includes(id) &&
        !PENDING_011.includes(id) &&
        !found.has(id),
    );
    expect(missing, `ids without a test name: ${missing.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-13 NFR-19 the 47 ids of spec 009 are pinned as pending and every one is a spec id', () => {
    // Independent computation with literal bounds.
    const literal = [
      ...Array.from({ length: 40 }, (_, i) => `FR-${316 + i}`),
      ...Array.from({ length: 7 }, (_, i) => `NFR-${58 + i}`),
    ];
    expect(literal).toHaveLength(47);
    expect(literal[0]).toBe('FR-316');
    expect(literal).toContain('FR-355');
    expect(literal).toContain('NFR-64');
    // Ledger of spec 009: 0 done / 47 pending at the start; each task moves its ids in its own commit.
    // M1 T2 adds FR-318, FR-321, FR-322 (3 / 44); T3 adds FR-323, FR-324, FR-325, FR-343, FR-346 (8 / 39); T4 adds FR-331, FR-332, FR-334, FR-335, FR-348 (13 / 34); T5 adds FR-327, FR-328, FR-329, FR-333, FR-347, FR-353, FR-354 (20 / 27). M2 T2 adds FR-316, FR-319, FR-320, FR-336, FR-338, FR-349 (26 / 21); M2 T3 adds FR-342, FR-344 (28 / 19); M2 T4 adds NFR-59, NFR-60 (30 / 17). M3 T2 adds FR-317, FR-339, FR-340, NFR-61 (34 / 13); M3 T3 adds FR-337, FR-345, FR-350 (37 / 10); M3 T4 adds FR-330, NFR-64 (39 / 8); M3 T5 adds FR-351, FR-352 (41 / 6). M4 T2 adds FR-326, FR-355; M4 T4 adds FR-341; M4 T5 adds NFR-58, NFR-62 (46 / 1). M5 T4 adds NFR-63 (47 / 0).
    expect(PENDING_009).toHaveLength(47 - DONE_009.length);
    expect(new Set([...PENDING_009, ...DONE_009]).size).toBe(47);
    expect([...PENDING_009, ...DONE_009].sort()).toStrictEqual([...literal].sort());
    for (const id of PENDING_009) {
      expect(specIds, id).toContain(id);
      expect(expected, id).toContain(id);
    }
  });

  it('NFR-13 NFR-19 M1 closing state of spec 009: 20 ids done and 27 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the tour core (pure model) is done.
    const doneByM1 = [
      'FR-318', 'FR-321', 'FR-322', 'FR-323', 'FR-324', 'FR-325', 'FR-327', 'FR-328', 'FR-329', 'FR-331',
      'FR-332', 'FR-333', 'FR-334', 'FR-335', 'FR-343', 'FR-346', 'FR-347', 'FR-348', 'FR-353', 'FR-354',
    ];
    const pendingAfterM1 = [
      'FR-316', 'FR-317', 'FR-319', 'FR-320', 'FR-326', 'FR-330', 'FR-336', 'FR-337', 'FR-338', 'FR-339',
      'FR-340', 'FR-341', 'FR-342', 'FR-344', 'FR-345', 'FR-349', 'FR-350', 'FR-351', 'FR-352', 'FR-355',
      'NFR-58', 'NFR-59', 'NFR-60', 'NFR-61', 'NFR-62', 'NFR-63', 'NFR-64',
    ];
    expect(doneByM1).toHaveLength(20);
    expect(pendingAfterM1).toHaveLength(27);
    expect(new Set([...doneByM1, ...pendingAfterM1]).size).toBe(47);
    // The ids done by M1 stay done (later milestones only move more ids from the pending list) and are traced.
    const used = tracedIds(testSources);
    for (const id of doneByM1) {
      expect(DONE_009, id).toContain(id);
      expect(PENDING_009, id).not.toContain(id);
      expect(used.has(id), id).toBe(true);
    }
    // Every other id is done or pending, never both; at the end of M1 exactly these 27 are pending.
    for (const id of pendingAfterM1) expect(DONE_009.includes(id) !== PENDING_009.includes(id), id).toBe(true);
    expect(DONE_009.length).toBeGreaterThanOrEqual(20);
    expect(DONE_009.length + PENDING_009.length).toBe(47);
    // M1 target: 20 done / 27 pending (T6 pins the lists above at that state; M2 moves ids out of the 27).
  });

  it('NFR-13 NFR-19 M2 closing state of spec 009: 30 ids done and 17 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the tour core, decisions, driver and goldens are done.
    const doneByM2 = [
      'FR-316', 'FR-318', 'FR-319', 'FR-320', 'FR-321', 'FR-322', 'FR-323', 'FR-324', 'FR-325', 'FR-327',
      'FR-328', 'FR-329', 'FR-331', 'FR-332', 'FR-333', 'FR-334', 'FR-335', 'FR-336', 'FR-338', 'FR-342',
      'FR-343', 'FR-344', 'FR-346', 'FR-347', 'FR-348', 'FR-349', 'FR-353', 'FR-354', 'NFR-59', 'NFR-60',
    ];
    const pendingAfterM2 = [
      'FR-317', 'FR-326', 'FR-330', 'FR-337', 'FR-339', 'FR-340', 'FR-341', 'FR-345', 'FR-350', 'FR-351',
      'FR-352', 'FR-355', 'NFR-58', 'NFR-61', 'NFR-62', 'NFR-63', 'NFR-64',
    ];
    expect(doneByM2).toHaveLength(30);
    expect(pendingAfterM2).toHaveLength(17);
    expect(new Set([...doneByM2, ...pendingAfterM2]).size).toBe(47);
    const used = tracedIds(testSources);
    for (const id of doneByM2) {
      expect(DONE_009, id).toContain(id);
      expect(PENDING_009, id).not.toContain(id);
      expect(used.has(id), id).toBe(true);
    }
    // The ids still pending after M2 are done or pending, never both (M3 to M5 move them one by one).
    for (const id of pendingAfterM2) expect(DONE_009.includes(id) !== PENDING_009.includes(id), id).toBe(true);
    expect(DONE_009.length).toBeGreaterThanOrEqual(30);
    expect(DONE_009.length + PENDING_009.length).toBe(47);
  });

  it('NFR-13 NFR-19 M3 closing state of spec 009: 41 ids done and 6 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the tour core, decisions, driver, goldens, live model, panel and debug address are done.
    const doneByM3 = [
      'FR-316', 'FR-317', 'FR-318', 'FR-319', 'FR-320', 'FR-321', 'FR-322', 'FR-323', 'FR-324', 'FR-325',
      'FR-327', 'FR-328', 'FR-329', 'FR-330', 'FR-331', 'FR-332', 'FR-333', 'FR-334', 'FR-335', 'FR-336',
      'FR-337', 'FR-338', 'FR-339', 'FR-340', 'FR-342', 'FR-343', 'FR-344', 'FR-345', 'FR-346', 'FR-347',
      'FR-348', 'FR-349', 'FR-350', 'FR-351', 'FR-352', 'FR-353', 'FR-354', 'NFR-59', 'NFR-60', 'NFR-61',
      'NFR-64',
    ];
    const pendingAfterM3 = ['FR-326', 'FR-341', 'FR-355', 'NFR-58', 'NFR-62', 'NFR-63'];
    expect(doneByM3).toHaveLength(41);
    expect(pendingAfterM3).toHaveLength(6);
    expect(new Set([...doneByM3, ...pendingAfterM3]).size).toBe(47);
    const used = tracedIds(testSources);
    for (const id of doneByM3) {
      expect(DONE_009, id).toContain(id);
      expect(PENDING_009, id).not.toContain(id);
      expect(used.has(id), id).toBe(true);
    }
    // M4 (drawing, skip, figures, screenshots) and M5 (NFR-63) move the last six out.
    for (const id of pendingAfterM3) expect(DONE_009.includes(id) !== PENDING_009.includes(id), id).toBe(true);
    expect(DONE_009.length).toBeGreaterThanOrEqual(41);
    expect(DONE_009.length + PENDING_009.length).toBe(47);
  });

  it('NFR-13 NFR-19 M4 T2 state of spec 009: 43 ids done and 4 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the dim shading (FR-326, FR-355) is added to the 41 of M3.
    const newInT2 = ['FR-326', 'FR-355'];
    const pendingAfterT2 = ['FR-341', 'NFR-58', 'NFR-62', 'NFR-63'];
    expect(pendingAfterT2).toHaveLength(4);
    const used = tracedIds(testSources);
    for (const id of newInT2) {
      expect(DONE_009, id).toContain(id);
      expect(PENDING_009, id).not.toContain(id);
      expect(used.has(id), id).toBe(true);
    }
    // M4 T4 (FR-341), M4 T5 (NFR-58, NFR-62) and M5 (NFR-63) move the last four out.
    for (const id of pendingAfterT2) expect(DONE_009.includes(id) !== PENDING_009.includes(id), id).toBe(true);
    expect(DONE_009.length).toBeGreaterThanOrEqual(43);
    expect(DONE_009.length + PENDING_009.length).toBe(47);
  });

  it('NFR-13 NFR-19 M4 T4 state of spec 009: 44 ids done and 3 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the skip control (FR-341) is added to the 43 of M4 T2.
    const pendingAfterT4 = ['NFR-58', 'NFR-62', 'NFR-63'];
    expect(pendingAfterT4).toHaveLength(3);
    expect(DONE_009).toContain('FR-341');
    expect(PENDING_009).not.toContain('FR-341');
    expect(tracedIds(testSources).has('FR-341')).toBe(true);
    // M4 T5 (NFR-58, NFR-62) and M5 (NFR-63) move the last three out.
    for (const id of pendingAfterT4) expect(DONE_009.includes(id) !== PENDING_009.includes(id), id).toBe(true);
    expect(DONE_009.length).toBeGreaterThanOrEqual(44);
    expect(DONE_009.length + PENDING_009.length).toBe(47);
  });

  it('NFR-13 NFR-19 M4 closing state of spec 009: 46 ids done and 1 pending, both as literal lists', () => {
    // Literal lists, independent of DONE_009 and PENDING_009: the drawing, the debug shell, the figures and the review rounds are done.
    const doneByM4 = [
      'FR-316', 'FR-317', 'FR-318', 'FR-319', 'FR-320', 'FR-321', 'FR-322', 'FR-323', 'FR-324', 'FR-325',
      'FR-326', 'FR-327', 'FR-328', 'FR-329', 'FR-330', 'FR-331', 'FR-332', 'FR-333', 'FR-334', 'FR-335',
      'FR-336', 'FR-337', 'FR-338', 'FR-339', 'FR-340', 'FR-341', 'FR-342', 'FR-343', 'FR-344', 'FR-345',
      'FR-346', 'FR-347', 'FR-348', 'FR-349', 'FR-350', 'FR-351', 'FR-352', 'FR-353', 'FR-354', 'FR-355',
      'NFR-58', 'NFR-59', 'NFR-60', 'NFR-61', 'NFR-62', 'NFR-64',
    ];
    expect(doneByM4).toHaveLength(46);
    expect(new Set([...doneByM4, 'NFR-63']).size).toBe(47);
    const used = tracedIds(testSources);
    for (const id of doneByM4) {
      expect(DONE_009, id).toContain(id);
      expect(PENDING_009, id).not.toContain(id);
      expect(used.has(id), id).toBe(true);
    }
    // M5 (the live shell and the real-server proofs) closes NFR-63: see the M5 closing state below.
    expect(DONE_009.length).toBeGreaterThanOrEqual(46);
  });

  it('NFR-13 NFR-19 M5 closing state of spec 009: all 47 ids done and none pending, both as literal lists', () => {
    const literal = [
      ...Array.from({ length: 40 }, (_, i) => `FR-${316 + i}`),
      ...Array.from({ length: 7 }, (_, i) => `NFR-${58 + i}`),
    ];
    expect(literal).toHaveLength(47);
    expect(PENDING_009).toStrictEqual([]);
    expect([...DONE_009].sort()).toStrictEqual([...literal].sort());
    const used = tracedIds(testSources);
    for (const id of literal) expect(used.has(id), id).toBe(true);
  });

  it('NFR-13 NFR-19 no pending id of spec 009 is already traced by a test title', () => {
    const used = tracedIds(testSources);
    const traced = PENDING_009.filter((id) => used.has(id));
    expect(traced, `remove from PENDING_009: ${traced.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-13 NFR-19 the pending check of spec 009 sees an id planted in a test title, over a synthetic list', () => {
    const synthetic = ['FR-901', 'FR-902'];
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-902 a', () => {});" });
    expect(synthetic.filter((id) => planted.has(id))).toStrictEqual(['FR-902']);
    expect(synthetic.filter((id) => tracedIds({ 'x/a.test.ts': "it('FR-9020 a', () => {});" }).has(id))).toStrictEqual([]);
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

  it('NFR-13 NFR-19 the 20 ids of spec 010 are pinned: closed ones plus pending ones, as literal lists, every one a spec id', () => {
    const literal = [
      ...Array.from({ length: 13 }, (_, i) => `FR-${356 + i}`),
      ...Array.from({ length: 7 }, (_, i) => `NFR-${65 + i}`),
    ];
    expect(literal).toHaveLength(20);
    expect([...PENDING_010, ...DONE_010].sort()).toStrictEqual([...literal].sort());
    expect(DONE_010).toHaveLength(17);
    for (const id of literal) expect(specIds, id).toContain(id);
    const used = tracedIds(testSources);
    for (const id of DONE_010) expect(used.has(id), id).toBe(true);
    for (const id of DONE_010) expect(PENDING_010, id).not.toContain(id);
  });

  it('NFR-13 NFR-19 the 29 ids of spec 011 are pinned: pending plus done, as literal lists, every one a spec id', () => {
    // Independent computation with literal bounds: 24 FR from 369, 5 NFR from 72.
    const literal = [
      ...Array.from({ length: 24 }, (_, i) => `FR-${369 + i}`),
      ...Array.from({ length: 5 }, (_, i) => `NFR-${72 + i}`),
    ];
    expect(literal).toHaveLength(29);
    expect(literal[0]).toBe('FR-369');
    expect(literal).toContain('FR-392');
    expect(literal).toContain('NFR-76');
    expect(PENDING_011.length + DONE_011.length).toBe(29);
    expect(new Set([...PENDING_011, ...DONE_011]).size).toBe(29);
    expect([...PENDING_011, ...DONE_011].sort()).toStrictEqual([...literal].sort());
    for (const id of literal) {
      expect(specIds, id).toContain(id);
      expect(expected, id).toContain(id);
    }
    for (const id of DONE_011) expect(PENDING_011, id).not.toContain(id);
  });

  it('NFR-13 NFR-19 spec 011 after the forced-absorber core task: the first id is done and traced (1 done, 28 pending at this step; later tasks add to it)', () => {
    expect(DONE_011).toContain('FR-387');
    expect(PENDING_011).not.toContain('FR-387');
    expect(DONE_011.length).toBeGreaterThanOrEqual(1);
    expect(tracedIds(testSources).has('FR-387')).toBe(true);
  });

  it('NFR-55 no pending id of spec 011 is already traced by a test title', () => {
    const used = tracedIds(testSources);
    const traced = PENDING_011.filter((id) => used.has(id));
    expect(traced, `move to DONE_011: ${traced.join(', ')}`).toStrictEqual([]);
  });

  it('NFR-55 the pending check of spec 011 sees an id planted in a test title, over a synthetic list', () => {
    const synthetic = ['FR-901', 'FR-902'];
    const planted = tracedIds({ 'x/a.test.ts': "it('FR-902 a', () => {});" });
    expect(synthetic.filter((id) => planted.has(id))).toStrictEqual(['FR-902']);
    expect(synthetic.filter((id) => tracedIds({ 'x/a.test.ts': "it('FR-9020 a', () => {});" }).has(id))).toStrictEqual([]);
  });
});
