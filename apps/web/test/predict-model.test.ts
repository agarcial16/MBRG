import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/core/strings';
import {
  bookAfterReply,
  bookFromOwn,
  emptyBook,
  factionAt,
  isTap,
  localIdOf,
  noOfferText,
  offerOf,
  offerText,
  orderByTerritories,
  pickFor,
  repeatsPick,
  sentFor,
  sentText,
  submitFailure,
  territoryCounts,
} from '../src/core/predict-model';
import type { LiveModel } from '../src/core/live-model';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const PLAYER = 'player:Ab3_x-9.Qz1k';
const REQUEST = '0123456789abcdef0123456789abcdef';

/** A model at the start of round 1 (phase 1 open), and after the reveal of its victim (phase 2). */
async function phase1(): Promise<{ model: LiveModel; d: Driver }> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  await d.load(0);
  return { model: d.model, d };
}

async function phase2(): Promise<LiveModel> {
  const { d } = await phase1();
  // The events of round 1 up to the reveal and the phase-2 schedule (seq 2 to 4).
  await d.events(eventsOfRound(d.s, 1).slice(0, 3));
  return d.model;
}

const names = (id: number): string => `F${id}`;
const asModel = (model: LiveModel, extra: Partial<LiveModel>): LiveModel => ({ ...model, ...extra });

describe('FR-401 FR-402 the order of the choices', () => {
  it('FR-402 largest first, ties by faction id', () => {
    const counts = new Map([[5, 3], [2, 3], [9, 7], [1, 1]]);
    expect(orderByTerritories([1, 2, 5, 9], counts)).toStrictEqual([9, 2, 5, 1]);
    expect(orderByTerritories([5, 2], new Map())).toStrictEqual([2, 5]);
  });

  it('FR-402 the territory counts come from the owners', () => {
    const counts = territoryCounts(new Map([[10, 4], [11, 4], [12, 7]]));
    expect(counts.get(4)).toBe(2);
    expect(counts.get(7)).toBe(1);
    expect(territoryCounts(undefined).size).toBe(0);
  });
});

describe('FR-401 FR-402 FR-403 FR-405 the offer', () => {
  it('FR-401 phase 1 offers the factions living at N in order of territories, for round N + 1', async () => {
    const { model } = await phase1();
    const offer = offerOf(model, { joined: true, revealing: false });
    expect(offer.type).toBe('victim');
    if (offer.type !== 'victim') return;
    expect(offer.round).toBe(1);
    const counts = territoryCounts(model.held.get(0));
    expect([...offer.choices].sort((a, b) => a - b)).toStrictEqual([...counts.keys()].sort((a, b) => a - b));
    for (let i = 1; i < offer.choices.length; i++) {
      const a = counts.get(offer.choices[i - 1] as number) as number;
      const b = counts.get(offer.choices[i] as number) as number;
      expect(a > b || (a === b && (offer.choices[i - 1] as number) < (offer.choices[i] as number))).toBe(true);
    }
  });

  it('FR-402 phase 2 offers the candidates of the revealed victim ordered by territories', async () => {
    const model = asModel(await phase2(), {});
    expect(model.stage).toBe('phase-2');
    const victim = model.victim!;
    const many = asModel(model, { victim: { ...victim, candidates: [3, 8, 5] } });
    const offer = offerOf(many, { joined: true, revealing: false });
    expect(offer.type).toBe('absorber');
    if (offer.type !== 'absorber') return;
    expect(offer.round).toBe(victim.round);
    expect([...offer.choices].sort((a, b) => a - b)).toStrictEqual([3, 5, 8]);
    expect(offer.choices).toStrictEqual(orderByTerritories([3, 8, 5], territoryCounts(model.held.get(model.applied))));
  });

  it('FR-403 a forced round offers no choice, only the faction', async () => {
    const model = await phase2();
    const forced = asModel(model, { victim: { ...model.victim!, candidates: [4], forced: true } });
    expect(offerOf(forced, { joined: true, revealing: false })).toStrictEqual({ type: 'forced', round: model.victim!.round, faction: 4 });
    const text = offerText(offerOf(forced, { joined: true, revealing: false }), names);
    expect(text.line).toContain('F4');
    expect(STRINGS.predictForcedNote).toContain('no da puntos');
  });

  it('FR-403 a single candidate that is not marked forced still offers a choice list', async () => {
    const model = await phase2();
    const one = asModel(model, { victim: { ...model.victim!, candidates: [4] } });
    expect(offerOf(one, { joined: true, revealing: false }).type).toBe('absorber');
  });

  it('FR-409 the absorber offer waits while the victim reveal tour runs', async () => {
    const model = await phase2();
    expect(offerOf(model, { joined: true, revealing: true })).toStrictEqual({ type: 'none', reason: 'revealing' });
  });

  it('FR-404 nothing is offered to a viewer who did not join, in a replay, while loading or outside the two phases', async () => {
    const { model, d } = await phase1();
    expect(offerOf(model, { joined: false, revealing: false })).toStrictEqual({ type: 'none', reason: 'not-joined' });
    expect(offerOf(asModel(model, { displayed: undefined }), { joined: true, revealing: false })).toStrictEqual({ type: 'none', reason: 'loading' });
    expect(offerOf(asModel(model, { applied: 3, displayed: 2, held: new Map(model.held).set(3, model.held.get(0)!) }), { joined: true, revealing: false })).toStrictEqual({ type: 'none', reason: 'behind' });
    for (const stage of ['locked', 'finished', 'halted', 'lobby', 'expired'] as const) {
      expect(offerOf(asModel(model, { stage }), { joined: true, revealing: false }), stage).toStrictEqual({ type: 'none', reason: 'closed' });
    }
    expect(d.model.stage).toBe('phase-1');
  });

  it('FR-405 phase 2 without the victim of the round offers nothing', async () => {
    const model = await phase2();
    expect(offerOf(asModel(model, { victim: undefined }), { joined: true, revealing: false })).toStrictEqual({ type: 'none', reason: 'closed' });
    expect(offerOf(asModel(model, { victim: { ...model.victim!, round: 9 } }), { joined: true, revealing: false })).toStrictEqual({ type: 'none', reason: 'closed' });
  });
});

describe('FR-401 the submission', () => {
  const offer = { type: 'victim', round: 2, choices: [4, 7] } as const;

  it('FR-401 the body names the kind, the round, the faction, the LOCAL player id and the request id', () => {
    expect(pickFor(offer, 7, PLAYER, REQUEST)).toStrictEqual({ ok: true, body: { kind: 'victim', round: 2, faction: 7, playerId: 'Ab3_x-9.Qz1k', requestId: REQUEST } });
    expect(pickFor({ type: 'absorber', round: 3, choices: [1] }, 1, PLAYER, REQUEST)).toMatchObject({ ok: true, body: { kind: 'absorber', round: 3 } });
    expect(localIdOf('player:abc')).toBe('abc');
  });

  it('FR-404 a faction outside the choices, a forced round and no offer are refused with a sentence', () => {
    expect(pickFor(offer, 9, PLAYER, REQUEST)).toStrictEqual({ ok: false, sentence: STRINGS.predictNotChoosable });
    expect(pickFor(offer, undefined, PLAYER, REQUEST)).toStrictEqual({ ok: false, sentence: STRINGS.predictNotChoosable });
    expect(pickFor({ type: 'forced', round: 2, faction: 4 }, 4, PLAYER, REQUEST)).toStrictEqual({ ok: false, sentence: STRINGS.predictForcedNote });
    expect(pickFor({ type: 'none', reason: 'behind' }, 4, PLAYER, REQUEST)).toStrictEqual({ ok: false, sentence: STRINGS.predictNoneBehind });
  });

  it('FR-404 one plain sentence per reason', () => {
    const reasons = ['not-joined', 'loading', 'behind', 'closed', 'revealing'] as const;
    const texts = reasons.map(noOfferText);
    expect(new Set(texts).size).toBe(reasons.length);
    expect(submitFailure('prediction-closed')).toBe(STRINGS.predictClosed);
    expect(submitFailure('forced-absorber')).toBe(STRINGS.predictForcedNote);
    expect(submitFailure('invalid-choice')).toBe(STRINGS.predictNotChoosable);
    expect(submitFailure('forbidden')).toBe(STRINGS.predictForbidden);
    expect(submitFailure('network')).toBe(STRINGS.createNetwork);
    expect(submitFailure('rate-limited', 7)).toContain('7');
    expect(submitFailure('something-else')).toBe(STRINGS.predictFailed);
  });
});

describe('FR-401 the book of sent choices', () => {
  it('FR-401 the own predictions fill the book; winners are ignored; the highest version wins', () => {
    const book = bookFromOwn([
      { playerId: 'x', kind: 'victim', round: 2, choice: 4, version: 1 },
      { playerId: 'x', kind: 'victim', round: 2, choice: 7, version: 3 },
      { playerId: 'x', kind: 'victim', round: 2, choice: 5, version: 2 },
      { playerId: 'x', kind: 'absorber', round: 2, choice: 6, version: 1 },
      { playerId: 'x', kind: 'winner', choice: 9, version: 1 },
    ]);
    expect(sentFor(book, { type: 'victim', round: 2, choices: [] })).toBe(7);
    expect(sentFor(book, { type: 'absorber', round: 2, choices: [] })).toBe(6);
    expect(sentFor(book, { type: 'victim', round: 3, choices: [] })).toBeUndefined();
    expect(sentFor(book, { type: 'forced', round: 2, faction: 1 })).toBeUndefined();
    expect(sentFor(book, { type: 'none', reason: 'closed' })).toBeUndefined();
  });

  it('FR-401 a change replaces the choice and a late older reply does not', () => {
    let book = bookAfterReply(emptyBook, { kind: 'victim', round: 2, choice: 4, version: 1 });
    book = bookAfterReply(book, { kind: 'victim', round: 2, choice: 7, version: 3 });
    book = bookAfterReply(book, { kind: 'victim', round: 2, choice: 5, version: 2 });
    expect(sentFor(book, { type: 'victim', round: 2, choices: [] })).toBe(7);
    expect(bookAfterReply(book, { kind: 'winner', choice: 1, version: 9 })).toBe(book);
    // The same version again (a repeated reply) keeps what is stored.
    expect(bookAfterReply(book, { kind: 'victim', round: 2, choice: 99, version: 3 })).toBe(book);
  });

  it('FR-401 the sent line names the faction', () => {
    expect(sentText('Roma')).toBe('Enviada: Roma');
  });
});

describe('FR-401 a tap on the map', () => {
  // A 4 x 2 image: entries 1 and 2 (territories 100 and 200), 0 is outside; territory 300 has no owner.
  const grid = { width: 4, height: 2, cells: [1, 1, 2, 0, 1, 3, 2, 2], ids: [0, 100, 200, 300] };
  const owners = new Map([[100, 7], [200, 8]]);

  it('FR-401 the owner of the territory under the point', () => {
    expect(factionAt({ x: 0.5, y: 0.5 }, grid, owners)).toBe(7);
    expect(factionAt({ x: 2.9, y: 1.1 }, grid, owners)).toBe(8);
  });

  it('FR-404 outside the image, outside the map, an unowned territory or no owners name nothing', () => {
    expect(factionAt({ x: 3.5, y: 0.5 }, grid, owners)).toBeUndefined();
    expect(factionAt({ x: -0.1, y: 0 }, grid, owners)).toBeUndefined();
    expect(factionAt({ x: 4, y: 0 }, grid, owners)).toBeUndefined();
    expect(factionAt({ x: 0, y: 2 }, grid, owners)).toBeUndefined();
    expect(factionAt({ x: 1.5, y: 1.5 }, grid, owners)).toBeUndefined();
    expect(factionAt({ x: 0.5, y: 0.5 }, grid, undefined)).toBeUndefined();
  });

  it('FR-401 a press and release close and quick is a tap; a drag or a long press is not', () => {
    expect(isTap({ sx: 10, sy: 10, at: 0 }, { sx: 13, sy: 12, at: 200 })).toBe(true);
    expect(isTap({ sx: 10, sy: 10, at: 0 }, { sx: 30, sy: 10, at: 100 })).toBe(false);
    expect(isTap({ sx: 10, sy: 10, at: 0 }, { sx: 10, sy: 10, at: 700 })).toBe(false);
    expect(isTap({ sx: 0, sy: 0, at: 0 }, { sx: 6, sy: 0, at: 600 })).toBe(true);
    expect(isTap({ sx: 0, sy: 0, at: 0 }, { sx: 7, sy: 0, at: 600 })).toBe(false);
  });
});

describe('repeatsPick (double tap guard)', () => {
  const offer = { type: 'victim', round: 3, choices: [1, 2] } as const;
  const book = bookAfterReply(emptyBook, { kind: 'victim', round: 3, choice: 1, version: 1 } as never);
  it('is false with nothing sent or in flight', () => {
    expect(repeatsPick(offer, 1, emptyBook, undefined)).toBe(false);
  });
  it('is true while the same choice is in flight', () => {
    expect(repeatsPick(offer, 1, emptyBook, { type: 'victim', round: 3, faction: 1 })).toBe(true);
  });
  it('is false for a different choice in flight, other round or kind', () => {
    expect(repeatsPick(offer, 2, emptyBook, { type: 'victim', round: 3, faction: 1 })).toBe(false);
    expect(repeatsPick(offer, 1, emptyBook, { type: 'victim', round: 2, faction: 1 })).toBe(false);
    expect(repeatsPick(offer, 1, emptyBook, { type: 'absorber', round: 3, faction: 1 })).toBe(false);
  });
  it('is true for the last confirmed choice of the phase, false for another', () => {
    expect(repeatsPick(offer, 1, book, undefined)).toBe(true);
    expect(repeatsPick(offer, 2, book, undefined)).toBe(false);
  });
  it('is false when there is no offer to repeat', () => {
    expect(repeatsPick({ type: 'none', reason: 'closed' }, 1, book, undefined)).toBe(false);
  });
});
