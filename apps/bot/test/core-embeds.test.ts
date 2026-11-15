import type { MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { buildAnnouncement, closedMessage, countdownMessage } from '../src/core/announce';
import { PREDICT_ID } from '../src/core/custom-ids';
import { EMBED_COLORS } from '../src/core/embeds';
import { EMBED_LIMITS, fitEmbed } from '../src/core/limits';
import type { EmbedSpec } from '../src/core/model';
import { nameBook } from '../src/core/names';
import { summarizeWinners } from '../src/core/results';
import { sendMode } from '../src/core/send-mode';
import type { Followed } from '../src/core/state';

const HOST = 'h'.repeat(24);
const entry = (over: Partial<Followed> = {}): Followed => ({ matchId: 'm1', mapId: 'europe', hostToken: HOST, lastSeq: 1, appliedRounds: 0, forcedRound: 0, ...over });
const names = nameBook([
  { id: 1, name: 'Alemania' },
  { id: 2, name: 'España' },
  { id: 3, name: 'Francia' },
]);
const ctx = (over: Partial<Followed> = {}, viewerUrl?: string) => ({ follow: entry(over), names, ...(viewerUrl === undefined ? {} : { viewerUrl }) });
const hex = 'ab'.repeat(32);

const schedule: MatchEvent = { type: 'schedule', seq: 2, stage: 'phase-1', reportedTime: 5 };
const revealed = (forced = false): MatchEvent => ({
  type: 'victim-revealed', seq: 3, round: 2, victim: 1, candidates: forced ? [3] : [2, 3], living: [1, 2, 3], revealedAt: 9, c2: null, a: null, ...(forced ? { forced: true as const } : {}), reportedTime: 9,
});
const applied: MatchEvent = { type: 'round-applied', seq: 6, round: 2, record: { round: 2, eliminated: 1, absorber: 2, transferred: [4] }, stateDigest: hex, appliedAt: 9 };
const scored = (phase: 1 | 2): MatchEvent => ({ type: 'results', seq: 7, round: 2, phase });
const finished: MatchEvent = { type: 'match-finished', seq: 9, winner: 3, matchSecret: hex, rule: 'rule', reportedTime: 1 };
const halted: MatchEvent = { type: 'match-halted', seq: 10, round: 2, reason: 'map-changed', reportedTime: 1 };
const fieldOf = (e: EmbedSpec | undefined, name: string): string | undefined => e?.fields.find((f) => f.name === name)?.value;
const embedOf = (event: MatchEvent, extras = {}, c = ctx()): EmbedSpec | undefined => buildAnnouncement(event, c, extras)[0]?.embed;

describe('FR-472 every announcement is an embed with a color per type', () => {
  const all: { name: string; embed: EmbedSpec | undefined }[] = [
    { name: 'opened', embed: embedOf(schedule) },
    { name: 'victim', embed: embedOf(revealed()) },
    { name: 'applied', embed: embedOf(applied, { left: 4 }) },
    { name: 'scored', embed: embedOf(scored(1), { winners: summarizeWinners(['discord:11']) }) },
    { name: 'finished', embed: embedOf(finished) },
    { name: 'halted', embed: embedOf(halted) },
  ];

  it('FR-472 each of the six message types has an embed with a title, and a color of its own', () => {
    for (const { name, embed } of all) {
      expect(embed, name).toBeDefined();
      expect(embed?.title.length, name).toBeGreaterThan(0);
    }
    const colors = all.map((a) => a.embed?.color);
    expect(new Set(colors).size).toBe(6);
    expect(colors).toEqual([EMBED_COLORS.opened, EMBED_COLORS.victim, EMBED_COLORS.applied, EMBED_COLORS.scored, EMBED_COLORS.finished, EMBED_COLORS.halted]);
  });

  it('FR-472 the forced reveal is a victim-revealed embed too; the plain text of 012 stays as the fallback of each message', () => {
    expect(embedOf(revealed(true))?.color).toBe(EMBED_COLORS.victim);
    const out = buildAnnouncement(applied, ctx(), { left: 4 });
    expect(out[0]?.text).toContain('Ronda 2 aplicada');
    expect(out[0]?.text).toContain('Quedan 4 facciones');
  });

  it('FR-472 no image: an embed spec has no image, video or map field (the bot avatar is added by the shell as the thumbnail)', () => {
    for (const { embed } of all) expect(Object.keys(embed ?? {}).sort()).toEqual(expect.arrayContaining(['color', 'fields', 'title']));
    for (const { embed } of all) expect(JSON.stringify(embed)).not.toMatch(/image|video|http/i);
  });
});

describe('FR-473 highlights', () => {
  it('FR-473 the victim is highlighted when revealed and when applied; the absorber when applied', () => {
    expect(fieldOf(embedOf(revealed()), 'Víctima')).toBe('**Alemania**');
    expect(fieldOf(embedOf(revealed(true)), 'Víctima')).toBe('**Alemania**');
    expect(fieldOf(embedOf(revealed(true)), 'Absorbente')).toContain('Francia');
    const a = embedOf(applied, { left: 4 });
    expect(fieldOf(a, 'Víctima')).toBe('**Alemania**');
    expect(fieldOf(a, 'Absorbente')).toBe('**España**');
    expect(fieldOf(a, 'Quedan')).toBe('4 facciones');
    expect(fieldOf(embedOf(applied, { left: 1 }), 'Quedan')).toBe('1 facción');
    expect(fieldOf(embedOf(applied), 'Quedan')).toBeUndefined();
  });

  it('FR-473 the members who guessed right are mentions, at most 10 then "y N más"; nobody right says so', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `discord:${1000 + i}`);
    const e = embedOf(scored(1), { winners: summarizeWinners(ids) });
    const v = fieldOf(e, 'Acertaron') ?? '';
    expect(v).toContain('<@1000>');
    expect(v).toContain('<@1009>');
    expect(v).not.toContain('<@1010>');
    expect(v).toContain('y 3 más');
    expect(e?.title).toContain('víctima');
    expect(embedOf(scored(2), { winners: summarizeWinners(ids.slice(0, 2)) })?.title).toContain('absorbente');
    expect(fieldOf(embedOf(scored(2), { winners: summarizeWinners([]) }), 'Acertaron')).toBe('Nadie acertó el absorbente.');
    expect(buildAnnouncement(scored(1), ctx())).toEqual([]);
  });

  it('FR-473 the final winner is highlighted and the match secret never shown', () => {
    const e = embedOf(finished);
    expect(fieldOf(e, 'Ganadora')).toBe('**Francia**');
    expect(JSON.stringify(buildAnnouncement(finished, ctx()))).not.toContain(hex);
    expect(embedOf(halted)?.description).toContain('ronda 2');
  });
});

describe('FR-474 the Predict flow lives in the open-phase embed', () => {
  it('FR-474 round opened and victim revealed keep ONE Predict button and the viewer link beside the embed', () => {
    for (const event of [schedule, revealed()]) {
      const [m] = buildAnnouncement(event, ctx({ appliedRounds: 1 }, 'https://viewer.example/'));
      expect(m?.embed).toBeDefined();
      expect(m?.buttons.filter((b) => b.type === 'custom')).toHaveLength(1);
      expect(m?.buttons.filter((b) => b.type === 'link')).toHaveLength(1);
    }
  });

  it('FR-474 the countdown and the closed state change the Predict label only, never the embed', () => {
    const [m] = buildAnnouncement(schedule, ctx(), {});
    if (m === undefined) throw new Error('no message');
    const counting = countdownMessage(m, 8);
    expect(counting.embed).toBe(m.embed);
    expect(counting.text).toBe(m.text);
    expect(counting.buttons[0]).toMatchObject({ customId: PREDICT_ID, label: 'Predecir · 8 s' });
    const closed = closedMessage(counting);
    expect(closed.embed).toBe(m.embed);
    expect(closed.buttons[0]).toMatchObject({ customId: PREDICT_ID, label: 'Predecir · cerrado', disabled: true });
  });
});

describe('NFR-92 secrecy of the embeds', () => {
  it('NFR-92 an embed holds no wrong guess, no guess count and nothing of a future round: only the data of its own event', () => {
    const planted = buildAnnouncement(revealed(), ctx(), { winners: summarizeWinners(['discord:11']), left: 2, board: [] });
    const whole = JSON.stringify([planted, buildAnnouncement(scored(1), ctx(), { winners: summarizeWinners(['discord:11', 'player:wrong', 'discord:22x']) })]);
    expect(whole).not.toContain('wrong');
    expect(whole).not.toContain('22x');
    // A victim reveal never lists its candidates (they are chosen by the member privately).
    expect(JSON.stringify(embedOf(revealed()))).not.toContain('Francia');
    expect(JSON.stringify(embedOf(schedule))).not.toContain('Alemania');
  });
});

describe('NFR-94 Discord embed limits', () => {
  it('NFR-94 title, description, field and footer are cut to their limits, fields to 25, and the whole to 6,000 characters', () => {
    const big: EmbedSpec = {
      color: 1,
      title: 'T'.repeat(400),
      description: 'D'.repeat(5000),
      footer: 'F'.repeat(3000),
      fields: Array.from({ length: 40 }, (_, i) => ({ name: `N${i}`.padEnd(400, 'n'), value: 'V'.repeat(2000) })),
    };
    const fit = fitEmbed(big);
    expect(fit.title.length).toBeLessThanOrEqual(EMBED_LIMITS.title);
    expect((fit.description ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    expect((fit.footer ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.footer);
    expect(fit.fields.length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
    for (const f of fit.fields) {
      expect(f.name.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldName);
      expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    }
    const total = fit.title.length + (fit.description ?? '').length + (fit.footer ?? '').length + fit.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(EMBED_LIMITS.total);
  });

  it('NFR-94 a small embed is returned as it is', () => {
    const small: EmbedSpec = { color: 2, title: 'a', description: 'b', fields: [{ name: 'c', value: 'd' }] };
    expect(fitEmbed(small)).toEqual(small);
  });
});

describe('FR-475 Embed Links decision', () => {
  it('FR-475 with the permission: embeds, no warning; without it: plain text and ONE warning per channel until it is granted again', () => {
    expect(sendMode(true, false)).toEqual({ mode: 'embed', warn: false, warned: false });
    expect(sendMode(false, false)).toEqual({ mode: 'text', warn: true, warned: true });
    expect(sendMode(false, true)).toEqual({ mode: 'text', warn: false, warned: true });
    expect(sendMode(true, true)).toEqual({ mode: 'embed', warn: false, warned: false });
  });
});
