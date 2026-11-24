import { describe, expect, it } from 'vitest';
import { SMALL_SCALE, describeRun, runScalePrototype } from '../src/cli/scale-prototype';
import { NFR_136, generateScaleFixture } from '../src/importer/scale-fixture';

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('the scale prototype on a reduced fixture', () => {
  it('runs the heavy path end to end on a small fixture and reports every step', { timeout: 60_000 }, () => {
    let tick = 0;
    const fixture = generateScaleFixture(SMALL_SCALE);
    const result = runScalePrototype(fixture, () => (tick += 10));
    expect(result.outcome).toBe('ok');
    expect(result.units).toBe(SMALL_SCALE.units);
    expect(result.seaZones).toBe(SMALL_SCALE.seas);
    expect(result.positions).toBe(fixture.counts.positions);
    expect(result.steps.map((s) => s.name)).toStrictEqual(['read', 'units', 'project', 'rasterize', 'inset', 'sea', 'cleanup']);
    // every step took the ticks of the fake clock: 10 ms (two readings a step)
    for (const step of result.steps) expect(step.ms).toBe(10);
    expect(result.totalMs).toBe(70);
    // the inset: a rectangle larger than the island group drawn in it, with the pixels of the 12 island units in it
    expect(result.inset.unitPixels).toBeGreaterThan(0);
    expect(result.inset.width * result.inset.height).toBeGreaterThan(result.inset.unitPixels);
    expect(result.inset.width).toBeGreaterThan(0);
    const text = describeRun(result, 5);
    expect(text).toContain('fixture: units=400 seaZones=10');
    expect(text).toContain('step cleanup: 10 ms');
    expect(text).toContain('outcome: ok');
  });
});

// The measurement of the bound is opt-in (never inside the default run): MBRG_SCALE=1 runs the fixture of the spec.
// The time is reported, not asserted, unless MBRG_SCALE_BOUND_MS names a bound (the 120 seconds of the spec is 120000).
const optIn = process.env['MBRG_SCALE'] === '1';
const bound = process.env['MBRG_SCALE_BOUND_MS'];

describe.skipIf(!optIn)('the NFR-136 scale prototype (opt-in: MBRG_SCALE=1)', () => {
  it('generates the fixture of the spec twice with identical bytes', { timeout: 600_000 }, () => {
    const a = generateScaleFixture(NFR_136);
    const b = generateScaleFixture(NFR_136);
    expect(a.counts).toStrictEqual(b.counts);
    expect(a.counts.units).toBe(8132);
    expect(a.counts.factions).toBe(52);
    expect(a.counts.seas).toBe(59);
    expect(a.counts.positions).toBeGreaterThanOrEqual(5_000_000);
    expect(same(a.primary, b.primary)).toBe(true);
    expect(same(a.context, b.context)).toBe(true);
    expect(same(a.curationBytes, b.curationBytes)).toBe(true);
  });

  it('runs the heavy steps on the core in place and reports the time of the bound', { timeout: 900_000 }, () => {
    const fixture = generateScaleFixture(NFR_136);
    const result = runScalePrototype(
      fixture,
      () => performance.now(),
      () => process.resourceUsage().maxRSS / 1024,
    );
    process.stdout.write(describeRun(result, 0));
    expect(result.outcome).toBe('ok');
    expect(result.units).toBe(8132);
    expect(result.landEntries + result.seaZones).toBe(8191);
    expect(result.pixels).toBe(4096 * 4096);
    if (bound !== undefined) expect(result.totalMs).toBeLessThan(Number(bound));
  });
});
