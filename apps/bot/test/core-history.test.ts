import type { HistoryEntry, HistoryPage, HistoryTopRow } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { EMBED_LIMITS, fitEmbed } from '../src/core/limits';
import { HISTORY_PAGE_SIZE, historyEmbed, historyEmpty, historyLink } from '../src/core/history';
import type { HistoryContext } from '../src/core/history';
import { nameBook } from '../src/core/names';
import { embedPayload, messagePayload } from '../src/discord/translate';

const VIEWER = 'https://viewer.example/play';
const top = (rank: number, user: string, points: number, name?: string): HistoryTopRow => ({ playerId: `discord:${user}`, points, rank, ...(name === undefined ? {} : { name }) });
const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  matchId: 'match-aaaa', mapId: 'europe', finishedAt: 1_800_000_000_500, winner: 3, playerCount: 4,
  top: [top(1, '111', 12), top(2, '222', 8), top(2, '333', 8)], more: 0, ...over,
});
const page = (items: HistoryEntry[], total = items.length): HistoryPage => ({ items, total });
const ctx = (over: Partial<HistoryContext> = {}): HistoryContext => ({
  page: 1,
  book: () => nameBook([{ id: 3, name: 'Francia' }]),
  viewerUrl: VIEWER,
  ...over,
});
const fieldsOf = (page_: HistoryPage, c: HistoryContext = ctx()) => historyEmbed(page_, c).embed?.fields ?? [];

describe('FR-554 the history embed', () => {
  it('FR-554 an entry shows the ordinal, the date as a Discord timestamp, the map, the winner, the player count, the top as one compact line of mentions and the viewer link', () => {
    const [field] = fieldsOf(page([entry()]));
    expect(field?.name).toBe('#1 · <t:1800000000:d> · europe');
    expect(field?.value.split('\n')).toEqual([
      'Ganó **Francia** · 4 jugadores',
      '🥇 <@111> 12 · 🥈 <@222> 8 · 🥉 <@333> 8',
      `[Ver en el visor](${VIEWER}?match=match-aaaa&spectate=1)`,
    ]);
  });

  it('FR-554 the title, the page indicator "Página N/M" from the snapshot total, and one field per entry in the order given', () => {
    const items = [entry({ matchId: 'm-1', finishedAt: 3_000_000 }), entry({ matchId: 'm-2', finishedAt: 2_000_000 }), entry({ matchId: 'm-3', finishedAt: 1_000_000 })];
    const view = historyEmbed(page(items, 12), ctx({ page: 2 }));
    expect(HISTORY_PAGE_SIZE).toBe(5);
    expect(view.embed?.title).toBe('Partidas terminadas');
    expect(view.embed?.footer).toBe('Página 2/3');
    expect(view.embed?.fields.map((f) => f.name)).toEqual(['#7 · <t:3000:d> · europe', '#6 · <t:2000:d> · europe', '#5 · <t:1000:d> · europe']);
    expect(historyEmbed(page(items, 5), ctx()).embed?.footer).toBe('Página 1/1');
    expect(historyEmbed(page(items, 6), ctx()).embed?.footer).toBe('Página 1/2');
  });

  it('the ordinal is the entry\'s position in the whole history, newest first: the snapshot total minus the page offset, the page clamped as the footer\'s', () => {
    const five = historyEmbed(page([1, 2, 3, 4, 5].map((i) => entry({ matchId: `m-${i}` })), 12), ctx({ page: 2 }));
    // A full page 2 of 12 holds the matches 7..3, newest first.
    expect(five.embed?.fields.map((f) => f.name.slice(0, 3))).toEqual(['#7 ', '#6 ', '#5 ', '#4 ', '#3 ']);
    // The partial last page of 12 holds the two oldest; an out-of-range page number clamps to it, as the footer clamps.
    const two = [entry({ matchId: 'm-x' }), entry({ matchId: 'm-y' })];
    const last = (pageNum: number) => historyEmbed(page(two, 12), ctx({ page: pageNum }));
    expect(last(3).embed?.fields.map((f) => f.name.slice(0, 3))).toEqual(['#2 ', '#1 ']);
    expect(last(99).embed?.fields.map((f) => f.name.slice(0, 3))).toEqual(['#2 ', '#1 ']);
  });

  it('FR-554 "y N más" ends the top line, only when rows with points were left out; the singular player count', () => {
    const value = fieldsOf(page([entry({ more: 3 })]))[0]?.value.split('\n') ?? [];
    expect(value).toHaveLength(3);
    expect(value[1]).toBe('🥇 <@111> 12 · 🥈 <@222> 8 · 🥉 <@333> 8 · y 3 más');
    expect(fieldsOf(page([entry({ more: 0 })]))[0]?.value).not.toContain('más');
    expect(fieldsOf(page([entry({ playerCount: 1, top: [top(1, '111', 5)] })]))[0]?.value.split('\n')[0]).toBe('Ganó **Francia** · 1 jugador');
  });

  it('FR-554 nobody scored: "Nadie sumó puntos" in place of the top, even with players on the board', () => {
    const value = fieldsOf(page([entry({ top: [], more: 0, playerCount: 7 })]))[0]?.value.split('\n');
    expect(value?.slice(0, 2)).toEqual(['Ganó **Francia** · 7 jugadores', 'Nadie sumó puntos']);
  });

  it('FR-554 the asker line has two forms and only appears when the request named the asker, with the viewer link merged into it', () => {
    const link = `[Ver en el visor](${VIEWER}?match=match-aaaa&spectate=1)`;
    expect(fieldsOf(page([entry({ asker: { points: 8, rank: 2 } })]))[0]?.value).toContain(`\nTus puntos: 8 (puesto 2) · ${link}`);
    expect(fieldsOf(page([entry({ asker: { points: 0, rank: 4 } })]))[0]?.value).toContain(`\nTus puntos: 0 (puesto 4) · ${link}`);
    expect(fieldsOf(page([entry({ asker: { played: false } })]))[0]?.value).toContain(`\nNo jugaste esta partida · ${link}`);
    const none = fieldsOf(page([entry()]))[0]?.value ?? '';
    expect(none).not.toContain('Tus puntos');
    expect(none).not.toContain('No jugaste');
  });

  it('FR-554 the link rides the asker\'s line; an entry without an asker keeps the link as its own last line', () => {
    const lines = fieldsOf(page([entry({ more: 1, asker: { points: 1, rank: 5 } })]))[0]?.value.split('\n') ?? [];
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('🥇 <@111> 12 · 🥈 <@222> 8 · 🥉 <@333> 8 · y 1 más');
    expect(lines[2]).toBe(`Tus puntos: 1 (puesto 5) · [Ver en el visor](${VIEWER}?match=match-aaaa&spectate=1)`);
    const noAsker = fieldsOf(page([entry()]))[0]?.value.split('\n') ?? [];
    expect(noAsker.at(-1)).toBe(`[Ver en el visor](${VIEWER}?match=match-aaaa&spectate=1)`);
  });

  it('FR-554 the viewer link is the spectator address of the match, and no link at all without a configured viewer', () => {
    expect(historyLink(VIEWER, 'match-aaaa')).toBe(`${VIEWER}?match=match-aaaa&spectate=1`);
    expect(historyLink(undefined, 'match-aaaa')).toBeUndefined();
    expect(historyLink('not a url', 'match-aaaa')).toBeUndefined();
    const value = fieldsOf(page([entry()]), ctx({ viewerUrl: undefined }))[0]?.value ?? '';
    expect(value).not.toContain('visor');
    expect(value).not.toContain('http');
    // With an asker and no viewer, the asker's line stays plain and last.
    const own = fieldsOf(page([entry({ asker: { points: 1, rank: 5 } })]), ctx({ viewerUrl: undefined }))[0]?.value.split('\n') ?? [];
    expect(own.at(-1)).toBe('Tus puntos: 1 (puesto 5)');
  });

  it('FR-554 a player of another namespace shows the stored name, else "Jugador"; a Discord player is always a mention', () => {
    const rows = [{ playerId: 'web:7', points: 9, rank: 1, name: 'Ana' }, { playerId: 'web:8', points: 5, rank: 2 }, top(3, '444', 1, 'Nombre guardado')];
    const lines = fieldsOf(page([entry({ top: rows })]))[0]?.value.split('\n') ?? [];
    expect(lines[1]).toBe('🥇 Ana 9 · 🥈 Jugador 5 · 🥉 <@444> 1');
  });
});

describe('FR-559 names that are not known', () => {
  it('FR-559 the map id stands for the map name when no name is known, and a known name replaces it', () => {
    expect(fieldsOf(page([entry({ mapId: 'mapa-viejo' })]))[0]?.name).toBe('#1 · <t:1800000000:d> · mapa-viejo');
    const named = ctx({ mapName: (id) => (id === 'europe' ? 'Europa 1914' : undefined) });
    expect(fieldsOf(page([entry(), entry({ mapId: 'asia' })]), named).map((f) => f.name)).toEqual(['#2 · <t:1800000000:d> · Europa 1914', '#1 · <t:1800000000:d> · asia']);
  });

  it('FR-559 a winner without a name shows its number as the announcements do (also when the map package is gone: no book)', () => {
    expect(fieldsOf(page([entry({ winner: 9 })]))[0]?.value.split('\n')[0]).toBe('Ganó **Facción 9** · 4 jugadores');
    expect(fieldsOf(page([entry()]), ctx({ book: () => nameBook([]) }))[0]?.value.split('\n')[0]).toBe('Ganó **Facción 3** · 4 jugadores');
  });

  it('FR-559 each entry uses the names of its own map', () => {
    const books = { europe: nameBook([{ id: 3, name: 'Francia' }]), asia: nameBook([{ id: 3, name: 'Japón' }]) } as const;
    const c = ctx({ book: (mapId) => books[mapId as keyof typeof books] ?? nameBook([]) });
    expect(fieldsOf(page([entry(), entry({ mapId: 'asia' }), entry({ mapId: 'otro' })]), c).map((f) => f.value.split('\n')[0])).toEqual([
      'Ganó **Francia** · 4 jugadores', 'Ganó **Japón** · 4 jugadores', 'Ganó **Facción 3** · 4 jugadores',
    ]);
  });
});

describe('NFR-122 the embed text is a pure function', () => {
  it('NFR-122 the same page and context give the same message, and the page given is left untouched', () => {
    const input = page([entry({ more: 2, asker: { points: 3, rank: 1 } })], 9);
    const before = JSON.stringify(input);
    const first = historyEmbed(input, ctx());
    expect(historyEmbed(input, ctx())).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('FR-556 the empty history', () => {
  it('FR-556 a community with no counted match is one public sentence, no embed and no buttons', () => {
    const empty = historyEmpty();
    expect(empty.text).toBe('Este servidor todavía no tiene partidas terminadas.');
    expect(empty.buttons).toEqual([]);
    expect(empty.embed).toBeUndefined();
    expect(historyEmbed(page([], 0), ctx())).toEqual(empty);
  });
});

describe('FR-475 the plain-text fallback', () => {
  it('FR-475 FR-554 the text carries the same lines as the embed: title, each entry, the page indicator, the bare address for the link', () => {
    const one = entry({ more: 2, asker: { points: 8, rank: 2 } });
    const two = entry({ matchId: 'match-bbbb', mapId: 'asia', top: [], playerCount: 2 });
    const view = historyEmbed(page([one, two], 7), ctx());
    const line = (i: number, j: number) => view.embed?.fields[i]?.value.split('\n')[j] ?? '';
    expect(view.text.split('\n')).toEqual([
      STRINGS.historyTitle,
      '#7 · <t:1800000000:d> · europe',
      line(0, 0),
      line(0, 1),
      `Tus puntos: 8 (puesto 2) · ${VIEWER}?match=match-aaaa&spectate=1`,
      '#6 · <t:1800000000:d> · asia',
      line(1, 0),
      STRINGS.historyNobody,
      `${VIEWER}?match=match-bbbb&spectate=1`,
      'Página 1/2',
    ]);
  });
});

describe('NFR-121 limits (embed part) and NFR-94', () => {
  const user = (n: number): string => String(10n ** 19n + BigInt(n));
  const name24 = (n: number): string => `Jugador-con-nombre-${String(n).padStart(5, '0')}`.slice(0, 24);
  const worst = (n: number): HistoryEntry =>
    entry({
      matchId: `match-${'z'.repeat(40)}-${n}`, mapId: `mapa-con-el-nombre-mas-largo-posible-${n}`, finishedAt: 9_999_999_999_000 + n, winner: 99, playerCount: 99_999,
      top: [1, 2, 3, 4, 5].map((r) => top(r, user(r), 9_999_999 - r)), more: 99_994, asker: { points: 9_999_999, rank: 99_999 },
    });
  const items = [1, 2, 3, 4, 5].map(worst);
  const long = ctx({
    page: 99_999, viewerUrl: `https://viewer.example/${'ruta/'.repeat(10)}play`,
    book: () => nameBook([{ id: 99, name: name24(99) }]), mapName: (id) => `${id}`.padEnd(48, 'M').slice(0, 48),
  });

  it('NFR-121 NFR-94 the worst page (5 entries, 24-character names, longest map name, 20-digit ids, full top, "y N más", asker, link) fits every Discord limit as built, without any cut', () => {
    const view = historyEmbed(page(items, 499_995), long);
    const embed = view.embed!;
    expect(embed.fields).toHaveLength(5);
    expect(embed.fields.length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
    expect((embed.description ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    for (const f of embed.fields) {
      expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
      expect(f.name.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldName);
    }
    const total = embed.title.length + (embed.description?.length ?? 0) + (embed.footer?.length ?? 0) + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(EMBED_LIMITS.total);
    // Nothing is lost to the safety cut of 017: the payload is the embed as built.
    expect(fitEmbed(embed)).toEqual(embed);
    expect(embedPayload(embed).fields).toHaveLength(5);
    // The compact line makes the worst case smaller: each entry is exactly three lines (winner, top, asker's line with the link).
    expect(embed.fields.every((f) => f.value.split('\n').length === 3)).toBe(true);
    expect(embed.fields.every((f) => f.value.includes('Tus puntos: 9999999 (puesto 99999) · [Ver en el visor]('))).toBe(true);
    expect(embed.fields.every((f) => f.value.includes(' · y 99994 más'))).toBe(true);
    expect(embed.fields.every((f) => f.value.includes('<@10000000000000000001>'))).toBe(true);
  });

  it('NFR-121 an entry of players with 24-character names in every row is within the limits too', () => {
    const rows = [1, 2, 3, 4, 5].map((r) => ({ playerId: `web:${r}`, points: 9_999_999, rank: r, name: name24(r) }));
    const view = historyEmbed(page(items.map((e) => ({ ...e, top: rows })), 500_000), long);
    for (const f of view.embed?.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    expect(fitEmbed(view.embed!)).toEqual(view.embed);
  });

  it('NFR-121 the plain text of the worst page is the lines of the embed: it is split by the shell into messages of at most 2,000 characters, none cut', () => {
    const view = historyEmbed(page(items, 499_995), long);
    expect(view.text.length).toBeGreaterThan(0);
    expect(view.text.split('\n').every((line) => line.length <= 2000)).toBe(true);
  });

  it('NFR-94 mentions never ping: the payload of a history message allows none', () => {
    const view = historyEmbed(page(items, 499_995), long);
    expect(messagePayload(view, { mode: 'embed' }).allowedMentions).toEqual({ parse: [] });
    expect(messagePayload(view, { mode: 'text' }).allowedMentions).toEqual({ parse: [] });
  });
});
