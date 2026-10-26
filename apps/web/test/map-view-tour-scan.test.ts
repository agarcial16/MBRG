import { describe, expect, it } from 'vitest';
import { codeOnly } from './helpers/scan';

// The tour driver of the map view (spec 009 M4 T3). The view touches WebGL and the DOM, so its wiring is read as text; the
// decisions (what a tour frame is, when the round-k views are asked for, what completing does) are the pure `tour-session`,
// tested in Node in tour-session.test.ts. These scans pin the wiring that the pure tests cannot see.
const all = import.meta.glob('../src/ui/map-view.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const source = Object.values(all)[0] as string | undefined;

/** The text from `marker` to its matching closing brace (the first `{` after the marker opens the body). */
export function bodyOf(code: string, marker: string): string {
  const at = code.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${marker}`);
}

const code = (): string => codeOnly(source!);
const LAYOUT_CALLS = /\b(?:viewOf|placeCentredFactions|placeCentredTerritories|roundLabels|labelCounts|buildPieceIndex|frontField|stepOf|measureAspects)\s*\(|\bself\.prepare\s*\(/;
const REQUEST_CALL = /(?<![.\w])request\(/;

describe('the map view scan sees the tour driver (not vacuous)', () => {
  it('map-view.ts has the four tour members and the hook', () => {
    expect(source).toBeDefined();
    for (const m of ['beginTour:', 'freezeTour:', 'completeTour:', 'userCamera:', 'onTour']) expect(code(), m).toContain(m);
  });
});

describe('FR-340 (shell) a tour that starts completes a running round step first', () => {
  it('FR-340 (shell) beginTour completes the running tour, then the running step, before the session is created', () => {
    const body = bodyOf(code(), 'beginTour: (requests, handlingMs, then) =>');
    const iSession = body.indexOf('completeSession(session');
    const iStep = body.indexOf('completeRunning(playback)');
    const iBegin = body.indexOf('beginSession(');
    expect(iSession).toBeGreaterThan(-1);
    expect(iStep).toBeGreaterThan(iSession);
    expect(iBegin).toBeGreaterThan(iStep);
    expect(body).toMatch(/playback = stepDone\.state;\s*stepView = undefined;/);
  });

  it('FR-340 (shell) a tour that does not play changes nothing (the plan is empty: it returns before any completion)', () => {
    const body = bodyOf(code(), 'beginTour: (requests, handlingMs, then) =>');
    expect(body.indexOf('plan.tours.length === 0')).toBeGreaterThan(-1);
    expect(body.indexOf('return false')).toBeLessThan(body.indexOf('completeSession('));
  });
});

describe('FR-333 (shell) only the user takes the camera', () => {
  it('FR-333 (shell) takeCamera is called in userCamera and nowhere else', () => {
    const c = code();
    expect([...c.matchAll(/\btakeCamera\(/g)]).toHaveLength(1);
    expect(bodyOf(c, 'userCamera: (next) =>')).toContain('takeCamera(session)');
  });

  it('FR-333 (shell) the tour paint path writes the camera only from the frame and never takes it', () => {
    const c = code();
    for (const name of ['const applyTour = (out: SessionPaint): boolean =>', 'beginTour: (requests, handlingMs, then) =>', 'completeTour: (nowMs) =>']) {
      const body = bodyOf(c, name);
      expect(body, name).not.toMatch(/takeCamera|userCamera/);
      expect(body, name).not.toMatch(/\bcamera = next\b/);
    }
    expect(bodyOf(c, 'const applyTour = (out: SessionPaint): boolean =>')).toContain('if (out.frame.camera !== undefined) camera = out.frame.camera;');
  });
});

describe('FR-344 (shell) a change of the reduced-motion preference completes a running tour', () => {
  it('FR-344 (shell) the watcher flags it and asks for a frame; the next frame completes through the session', () => {
    const c = code();
    const watcher = bodyOf(c, 'const motion = watchMotion(() =>');
    expect(watcher).toMatch(/if \(session !== undefined\) \{\s*[^}]*motionPending = true;\s*loop\.request\(\);/);
    const paintBody = bodyOf(c, 'const paint = (nowMs: number): boolean =>');
    expect(paintBody).toContain('motionPending ? motionChangedSession(session, nowMs, v)');
    expect(paintBody).toContain('motionPending = false;');
  });

  it('FR-344 (shell) the clock is never read in the view: the watcher has no reading, the step starts at the frame that completes', () => {
    expect(code()).not.toMatch(/\bnow\s*\(|performance|Date/);
  });
});

describe('the tour paint path computes no layout', () => {
  it('no layout function is called by paint (tour branch), applyTour (outside the prepare signal), freezeTour or completeTour', () => {
    const c = code();
    const apply = bodyOf(c, 'const applyTour = (out: SessionPaint): boolean =>');
    // The round-k views: asked for on the session's signal, or once at the hand-over when they are missing.
    const calls = [...apply.matchAll(new RegExp(LAYOUT_CALLS.source, 'g'))].map((m) => m[0].replace(/\s*\($/, ''));
    expect(calls).toStrictEqual(['self.prepare', 'self.prepare']);
    expect(apply).toMatch(/if \(out\.prepare && held !== undefined && heldViews === undefined\) heldViews = self\.prepare\(/);
    expect(apply).toMatch(/const prepared = heldViews \?\? self\.prepare\(/);
    const tourBranch = bodyOf(c, 'const paint = (nowMs: number): boolean =>').split('const out = frame(')[0]!;
    expect(tourBranch).not.toMatch(LAYOUT_CALLS);
    for (const name of ['freezeTour: (request, t, taken) =>', 'completeTour: (nowMs) =>']) expect(bodyOf(c, name), name).not.toMatch(LAYOUT_CALLS);
    // The boxes come from the layout of the drawn round, held, never computed.
    expect(bodyOf(c, 'const boxesOf = (')).toContain('current.layout.boxes');
    expect(bodyOf(c, 'const boxesOf = (')).not.toMatch(LAYOUT_CALLS);
  });
});

describe('FR-345 (shell) guard: until the end frame of an absorber tour the painted owners, labels and legend are those of round k - 1', () => {
  it('FR-345 (shell) beginTour holds the round step and changes neither the current view nor the playback round', () => {
    const body = bodyOf(code(), 'beginTour: (requests, handlingMs, then) =>');
    expect(body).toContain('held = then;');
    expect(body).not.toMatch(/\bcurrent\s*=[^=]/);
    expect(body).not.toMatch(/self\.commit|self\.prepare/);
    expect(body).not.toMatch(REQUEST_CALL);
    expect(body).not.toMatch(/playback = (?!stepDone)/);
  });

  it('FR-345 (shell) the current view changes in one place, the commit, which the hand-over reaches only on the end frame', () => {
    const c = code();
    const assigns = [...c.matchAll(/\bcurrent = [^=]/g)].length;
    // the load-time initial views (two branches) and the commit
    expect(assigns).toBe(3);
    expect(bodyOf(c, 'commit: (outcome, prepared, startedMs) =>')).toContain('current = prepared.round;');
    // One call, in applyTour (the hand-over); the public `commit` is the function itself.
    expect([...c.matchAll(/\bself\.commit\(/g)]).toHaveLength(1);
  });

  it('FR-345 (shell) a tour frame draws the table, labels and counts of the held current view, and the hand-over is gated by the end frame', () => {
    const apply = bodyOf(code(), 'const applyTour = (out: SessionPaint): boolean =>');
    expect(apply).toContain('mapScene.setOwners(current.table)');
    expect(apply).toContain('tourLabelDraws(current.labels,');
    expect(apply).toMatch(/if \(out\.ended && out\.step !== undefined && held !== undefined\) \{/);
    // The only commit sits inside that branch.
    const branch = bodyOf(apply, 'if (out.ended && out.step !== undefined && held !== undefined)');
    expect(branch).toContain('self.commit(');
    expect(apply.replace(branch, '')).not.toContain('self.commit(');
    expect(code()).toContain('counts: () => current.counts,');
  });
});

describe('completeTour with no tour running is a strict no-op', () => {
  it('completeTour returns before anything else when the session answers nothing, and never touches the playback', () => {
    const body = bodyOf(code(), 'completeTour: (nowMs) =>');
    expect(body).toMatch(/const out = completeSession\(session, nowMs, sessionView\(\)\);\s*if \(out === undefined\) return;\s*applyTour\(out\);/);
    expect(body).not.toMatch(/completeRunning|playback|stepView|self\.commit/);
    expect(body).not.toMatch(REQUEST_CALL);
  });
});

describe('the overlay and the dim reach the drawing', () => {
  it('the tour frame is drawn with the dim and the lit factions, the tour label draws and the overlay, and the plain drawing resets the dim', () => {
    const c = code();
    const apply = bodyOf(c, 'const applyTour = (out: SessionPaint): boolean =>');
    expect(apply).toContain('mapScene.setTour({ lit: out.frame.lit, dim: out.frame.dim });');
    expect(apply).toMatch(/present\(tourLabelDraws\(current\.labels, out\.frame\.lit, out\.frame\.factors\.other\), overlay\);/);
    const paintBody = bodyOf(c, 'const paint = (nowMs: number): boolean =>');
    expect(paintBody).toContain('mapScene.setTour(undefined);');
    expect(paintBody).toContain('present(drawn);');
  });
});
