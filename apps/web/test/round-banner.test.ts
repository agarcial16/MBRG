import { describe, expect, it } from 'vitest';
import type { LiveModel } from '../src/core/live-model';
import { BANNER_MS, bannerDismiss, bannerExpiresIn, bannerNext, bannerStart, bannerView, type BannerInput } from '../src/core/round-banner';
import { STRINGS, fillTemplate } from '../src/core/strings';

const NAMES = [{ id: 4, name: 'Norte' }, { id: 9, name: 'Sur' }];
const model = (extra: Record<string, unknown> = {}): LiveModel =>
  ({ displayed: 3, applied: 3, records: new Map([[3, { eliminated: 4, absorber: 9, transferred: [1, 2, 3] }]]), ...extra }) as unknown as LiveModel;
const input = (displayed: number | undefined, applied: number, extra: Partial<BannerInput> = {}): BannerInput => ({ displayed, applied, absorbing: false, revealing: false, ...extra });

describe('FR-408 the round banner', () => {
  it('FR-408 the first sight of the match shows no banner (the page opened in the middle)', () => {
    const state = bannerNext(bannerStart, input(3, 3), 1000);
    expect(bannerView(state, model(), NAMES, 1000, false)).toBeUndefined();
  });

  it('FR-408 a round applied at the live edge shows the number, victim, absorber and territories for 3 s', () => {
    let state = bannerNext(bannerStart, input(2, 2), 0);
    state = bannerNext(state, input(3, 3), 5000);
    const view = bannerView(state, model(), NAMES, 5000, false);
    expect(view).toStrictEqual({
      title: fillTemplate(STRINGS.bannerRound, { round: 3 }),
      line: fillTemplate(STRINGS.hudChronicleApplied, { victim: 'Norte', absorber: 'Sur', count: 3 }),
      fade: true,
    });
    expect(BANNER_MS).toBe(3000);
    expect(bannerView(state, model(), NAMES, 5000 + 2999, false)).toBeDefined();
    expect(bannerView(state, model(), NAMES, 5000 + 3000, false)).toBeUndefined();
    expect(bannerExpiresIn(state, 6000)).toBe(2000);
    expect(bannerExpiresIn(state, 9000)).toBeUndefined();
  });

  it('FR-408 with reduced motion it shows without fade', () => {
    const state = bannerNext(bannerNext(bannerStart, input(2, 2), 0), input(3, 3), 10);
    expect(bannerView(state, model(), NAMES, 10, true)?.fade).toBe(false);
  });

  it('FR-408 it waits while the absorber is being shown or the victim revealed, then shows', () => {
    let state = bannerNext(bannerStart, input(2, 2), 0);
    state = bannerNext(state, input(3, 3, { absorbing: true }), 100);
    expect(bannerView(state, model(), NAMES, 100, false)).toBeUndefined();
    state = bannerNext(state, input(3, 3), 4000);
    expect(bannerView(state, model(), NAMES, 4000, false)).toBeDefined();
  });

  it('FR-408 a jump, a replay or a step back shows no banner', () => {
    const state = bannerNext(bannerNext(bannerStart, input(1, 5), 0), input(4, 5), 10);
    expect(bannerView(state, model({ displayed: 4, applied: 5 }), NAMES, 10, false)).toBeUndefined();
    const jump = bannerNext(bannerNext(bannerStart, input(1, 5), 0), input(5, 5), 10);
    expect(bannerView(jump, model({ displayed: 5, applied: 5, records: new Map([[5, { eliminated: 4, absorber: 9, transferred: [1] }]]) }), NAMES, 10, false)).toBeUndefined();
  });

  it('FR-408 a tap or key dismisses it', () => {
    const state = bannerNext(bannerNext(bannerStart, input(2, 2), 0), input(3, 3), 10);
    const gone = bannerDismiss(state);
    expect(bannerView(gone, model(), NAMES, 20, false)).toBeUndefined();
    expect(bannerExpiresIn(gone, 20)).toBeUndefined();
    // The same round does not come back on a later refresh.
    expect(bannerView(bannerNext(gone, input(3, 3), 30), model(), NAMES, 30, false)).toBeUndefined();
  });

  it('FR-408 it is not shown once the screen leaves the round or the record is missing', () => {
    const state = bannerNext(bannerNext(bannerStart, input(2, 2), 0), input(3, 3), 10);
    expect(bannerView(state, model({ displayed: 2 }), NAMES, 20, false)).toBeUndefined();
    expect(bannerView(state, model({ records: new Map() }), NAMES, 20, false)).toBeUndefined();
  });
});
