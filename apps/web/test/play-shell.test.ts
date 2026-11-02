// The DOM shells of the player screens (spec 013): thin source scans. The pure modules decide what to show (play-forms, play-token,
// play-entry, lobby-model) and are tested in Node; these checks keep the shells thin, in Spanish through the strings module, and
// free of tokens in logs and addresses.
import { describe, expect, it } from 'vitest';
import { PANEL_CSS as css } from '../src/ui/live-panel-style';
import create from '../src/ui/play-create.ts?raw';
import dom from '../src/ui/play-dom.ts?raw';
import join from '../src/ui/play-join.ts?raw';
import lobby from '../src/ui/play-lobby.ts?raw';
import main from '../src/ui/play-main.ts?raw';
import entry from '../src/ui/entry.ts?raw';
import start from '../src/ui/live-start.ts?raw';
import { codeOnly, languageViolations } from './helpers/scan';

const shells = { 'play-create': create, 'play-dom': dom, 'play-join': join, 'play-lobby': lobby, 'play-main': main } as const;
const code = (src: string): string => codeOnly(src.replace(/\/\/.*$/gm, ''));

describe('NFR-77 the player screens speak Spanish through the strings module', () => {
  it('NFR-77 no shell writes a text literal into the page', () => {
    for (const [name, src] of Object.entries(shells)) expect(languageViolations(src), name).toStrictEqual([]);
  });

  it('NFR-77 the screens use the HUD look: the card, the buttons, the tokens and the layout attribute, with no colour of their own', () => {
    expect(dom).toMatch(/layoutFor\(/);
    expect(dom).toMatch(/dataset\.layout\s*=/);
    for (const name of ['hud-create', 'hud-choice', 'hud-players', 'hud-link']) expect(css, name).toContain(`.${name}`);
    const added = css.slice(css.indexOf('/* create, join and lobby (spec 013) */'), css.indexOf('/* messages of the address */'));
    expect(added.length).toBeGreaterThan(100);
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it('NFR-77 the controls are real buttons, links and labelled fields', () => {
    expect(dom).toMatch(/node\.type\s*=\s*'button'/);
    expect(join).toMatch(/aria-label/);
    expect(create).toMatch(/aria-pressed/);
    expect(dom).toMatch(/readOnly\s*=\s*true/);
  });
});

describe('NFR-78 no token is logged, put in an address or sent anywhere but the server', () => {
  it('NFR-78 no player screen logs, stores in a cookie or builds a request itself', () => {
    for (const [name, src] of Object.entries(shells)) {
      const c = code(src);
      expect(c, name).not.toMatch(/\b(?:console|document\.cookie|sessionStorage|XMLHttpRequest|sendBeacon|fetch\s*\()/);
    }
  });

  it('NFR-78 a personal link is opened from the fragment and the fragment is removed from the address', () => {
    expect(main).toMatch(/adoptFragment\(/);
    expect(main).toMatch(/history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
  });

  it('NFR-78 the personal link and the match link are built by the token module, from the page address without query or fragment', () => {
    expect(main).toMatch(/window\.location\.origin\}\$\{window\.location\.pathname\}/);
    expect(join).toMatch(/personalLink\(/);
    expect(lobby).toMatch(/matchLink\(/);
  });

  it('FR-394 the host token goes to the storage module and to the start call only', () => {
    expect(create).toMatch(/saveHost\(/);
    expect(create).not.toMatch(/Authorization|Bearer/);
    expect(lobby).toMatch(/deps\.net\.start\(deps\.matchId, deps\.hostToken/);
  });

  it('FR-393 the create screen never reads or stores an operator credential', () => {
    for (const [name, src] of Object.entries(shells)) expect(code(src), name).not.toMatch(/MBRG_CLIENTS|MBRG_OPERATOR|OPERATOR|WEB_CREDENTIAL|operator|import\.meta\.env/i);
  });
});

describe('FR-393 FR-396 FR-398 the shells hand their decisions to the pure modules', () => {
  it('FR-393 the create screen builds the body with createBody, reads the config and keeps the form after a failure', () => {
    expect(create).toMatch(/createBody\(/);
    expect(create).toMatch(/deps\.net\.config\(\)/);
    expect(create).toMatch(/createFailure\(read\.outcome, read\.retryAfter\)/);
    expect(create).toMatch(/The form keeps its values/);
  });

  it('FR-396 the join screen applies the name rule before it sends, and a retry of one name reuses its request id', () => {
    expect(join.indexOf('checkName(')).toBeGreaterThan(-1);
    expect(join.indexOf('checkName(')).toBeLessThan(join.indexOf('deps.net.join('));
    expect(join).toMatch(/draft\.name === checked\.name/);
    expect(join).toMatch(/joinFailure\(read\.outcome, read\.retryAfter\)/);
  });

  it('FR-397 the personal token is saved at join and the door resumes from the storage', () => {
    expect(join).toMatch(/savePlayer\(/);
    expect(main).toMatch(/loadPlayer\(/);
    expect(main).toMatch(/entryScreen\(/);
  });

  it('FR-398 the lobby asks only for the players, the public stage and the event stream, and reads no round', () => {
    const c = code(lobby);
    expect(lobby).toMatch(/deps\.net\.players\(/);
    expect(lobby).toMatch(/deps\.live\.readPublic\(/);
    expect(lobby).toMatch(/deps\.live\.openStream\(/);
    expect(c).not.toMatch(/readState|readRecord|readMapFiles|victim|absorber/i);
  });

  it('FR-399 the lobby leaves for the match on the schedule event or an accepted start, closing its stream first', () => {
    expect(lobby).toMatch(/next\.outcome === 'started'/);
    expect(lobby).toMatch(/control\.abort\(\);\s*then\(\)/);
    expect(lobby).toMatch(/if \(read\.ok\) return leave\(deps\.onStarted\)/);
  });

  it('FR-400 a join in a running match shows the notice before the match', () => {
    expect(join).toMatch(/afterJoin\(/);
    expect(join).toMatch(/next\.notice/);
  });

  it('FR-393 the entry page opens the match door, and the start screen mounts the create section', () => {
    expect(entry).toMatch(/live:\s*startMatchEntry/);
    expect(start).toMatch(/mountCreate\(/);
  });
});
