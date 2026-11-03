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
import session from '../src/ui/play-session.ts?raw';
import panel from '../src/ui/live-panel.ts?raw';
import input from '../src/ui/input.ts?raw';
import liveMain from '../src/ui/live-main.ts?raw';
import entry from '../src/ui/entry.ts?raw';
import start from '../src/ui/live-start.ts?raw';
import { codeOnly, languageViolations } from './helpers/scan';

const shells = { 'play-create': create, 'play-dom': dom, 'play-join': join, 'play-lobby': lobby, 'play-main': main, 'play-session': session } as const;
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

describe('FR-401 to FR-407 the prediction shells hand their decisions to the pure modules', () => {
  it('FR-401 the HUD bar choices are real buttons that report their selection and call the pick handler at once', () => {
    expect(panel).toContain("'hud-btn hud-pick'");
    expect(panel).toContain("'aria-pressed', String(choice.selected)");
    expect(panel).toContain('handlers.play?.onPick(choice.faction)');
    expect(code(panel)).not.toMatch(/\bconfirm\s*\(/);
    expect(css).toContain('.hud-pick');
  });

  it('FR-401 a tap on the map goes through the tap rule and the faction lookup, then to the session', () => {
    expect(input).toContain('isTap(');
    expect(input).toContain('target.onTap?.(');
    expect(liveMain).toContain('onTap:');
    expect(liveMain).toContain('factionAt(');
    expect(liveMain).toContain('session?.tap(');
  });

  it('FR-401 the submission is made by the pure pick rule and sent with the player token to the play net only', () => {
    expect(session).toContain('pickFor(');
    expect(session).toContain('deps.net.submit(deps.matchId, player.token, choice.body)');
    expect(session).toContain('submitFailure(read.outcome, read.retryAfter)');
  });

  it('FR-406 FR-407 the scores wait for the end of a reveal tour, then the chip, the panel and the board come from the pure view', () => {
    expect(session).toContain('hold.revealing || hold.absorbing');
    expect(session).toContain('playHud(');
    expect(liveMain).toContain('session.view(model, at, { revealing: shown.revealing, absorbing: shown.absorbing })');
    expect(liveMain).toContain('onFrame: (data) => session?.onFrame(data)');
  });

  it('FR-397 the player chip opens the personal link and the door passes the player to the match scene', () => {
    expect(panel).toContain('handlers.play?.fillPersonal(personal)');
    expect(session).toContain('personalBlock(parent, deps.pageUrl, deps.matchId, deps.player)');
    expect(main).toContain('startLiveScene(matchId, who)');
  });

  it('NFR-77 the rebuilt parts of the panel are rebuilt only when they change, so a countdown does not drop the keyboard focus', () => {
    expect(panel).toContain('predictSig');
    expect(panel).toContain('boardSig');
    expect(panel).toContain('chronSig');
  });
});

describe('screenshot pass: layout rules of the state card', () => {
  it('a centred card (start, loading, error) keeps its centre on the phone and scrolls when it is taller than the screen', () => {
    expect(css).toContain('.hud[data-layout="phone"][data-state="start"] .hud-card');
    expect(css).toMatch(/\.hud-card \{[^}]*max-height: calc\(100vh - 24px\)[^}]*overflow-y: auto/);
    const phoneTop = css.indexOf('.hud[data-layout="phone"] .hud-card { top: 168px;');
    const phoneCentred = css.indexOf('.hud[data-layout="phone"][data-state="start"] .hud-card');
    expect(phoneTop).toBeGreaterThan(-1);
    expect(phoneCentred).toBeGreaterThan(phoneTop);
  });
});

describe('screenshot pass: top bar, dock and desk panels', () => {
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('the phone top bar keeps the round on one line, shows the phase under it and lets the chip shrink', () => {
    expect(rule('.hud[data-layout="phone"] .hud-top .hud-round')).toContain('white-space: nowrap');
    expect(css).not.toContain('.hud-top .hud-phase { display: none; }');
    expect(rule('.hud[data-layout="phone"] .hud-top .hud-phase')).toContain('grid-area: phase');
    expect(rule('.hud[data-layout="phone"] .hud-top .hud-playerchip')).toContain('min-width: 0');
  });

  it('the dock panes have room on every side', () => {
    expect(rule('.hud-pane')).toMatch(/padding: \d+px 1[0-9]px \d+px/);
  });

  it('the Orden tab renders the prediction offer for a player and keeps the plain note for a page without a player', () => {
    expect(panel).toContain('renderOrderPredict(hud.play?.predict)');
    expect(panel).toContain('orderNote.hidden = hud.play !== undefined');
  });

  it('the desk command panel starts after the left column and the left column counts its padding in its width', () => {
    expect(rule('.hud-left')).toContain('box-sizing: border-box');
    const px = (text: string, property: string): number => Number(new RegExp(`[ ;{]${property}: ([0-9]+)px`).exec(text)![1]);
    expect(px(rule('.hud-command'), 'left')).toBeGreaterThanOrEqual(px(rule('.hud-left'), 'left') + px(rule('.hud-left'), 'width') + 8);
    expect(rule('.hud[data-layout="desk"] .hud-command')).toContain('flex-wrap: wrap');
  });
});

describe('screenshot pass: create screen and lobby layout', () => {
  it('the start screen takes the layout of the viewport, so the phone touch targets of 44 px apply to the create form', () => {
    expect(start).toContain('root.dataset.layout = layoutFor(window.innerWidth)');
    expect(css).toContain('.hud[data-layout="phone"] .hud-input { min-height: 44px; }');
    expect(css).toContain('.hud[data-layout="phone"] .hud-btn { min-height: 44px; min-width: 44px; }');
  });

  it('buttons never wrap their label and the lobby is two columns on the desk (players left, share and start right)', () => {
    expect(css).toContain('.hud-btn { white-space: nowrap; }');
    expect(css).toMatch(/\.hud\[data-layout="desk"\] \.hud-card\.hud-lobby \{[^}]*grid-template-columns/);
    expect(lobby).toContain("h('div', 'hud-lobby-players', card)");
    expect(lobby).toContain("h('div', 'hud-lobby-share', card)");
  });
});

describe('screenshot pass: small wording', () => {
  it('one faction alive reads in the singular', () => {
    expect(panel).toContain('alive === 1 ? STRINGS.hudAliveOfOne : STRINGS.hudAliveOf');
  });
});

describe('second screenshot pass: phone dock and chip', () => {
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('the dock pane has one fixed height of about a third of the screen for every tab, with no gap above it', () => {
    const pane = rule('.hud[data-layout="phone"] .hud-pane');
    expect(pane).toContain('height: clamp(250px, calc(37vh - 50px), 330px)');
    expect(pane).toContain('max-height: none');
    expect(rule('.hud-tabs')).not.toContain('margin-top');
  });

  it('an open phase shows the prediction and the buttons only; no open phase shows the result instead of the empty prediction', () => {
    expect(css).toContain('.hud[data-layout="phone"] .hud-command > .hud-title { display: none; }');
    expect(css).toContain('.hud[data-layout="phone"] .hud-command[data-offer="open"] > .hud-result { display: none; }');
    expect(css).toContain('.hud[data-layout="phone"] .hud-command[data-offer="closed"]:has(.hud-result:not([hidden])) > .hud-predict { display: none; }');
    expect(panel).toContain("command.dataset.offer = hud.play?.predict?.countdown !== undefined ? 'open' : 'closed'");
  });

  it('the chip shortens the name and never the score', () => {
    expect(rule('.hud-chip-name')).toContain('text-overflow: ellipsis');
    expect(rule('.hud-chip-stats')).toContain('flex: none');
    expect(panel).toContain("el('span', 'hud-chip-stats', chipButton)");
  });

  it('the ranking list scrolls inside the dock and the own row stays pinned', () => {
    expect(css).toContain('.hud[data-layout="phone"] .hud-right .hud-board:not(.hud-board-mine) { flex: 1 1 auto; min-height: 0; overflow: auto; }');
    expect(rule('.hud-boardrow.me')).toContain('position: sticky');
    expect(panel).toContain("'hud-board hud-board-mine'");
  });
});

describe('second screenshot pass: desk panel, outline, scrollbars and the round shown', () => {
  it('the desk command panel is compact: small buttons and dots, no repeated phase sentence while a prediction shows', () => {
    expect(css).toContain('.hud[data-layout="desk"] .hud-command .hud-btn { min-height: 30px; padding: 0 10px; }');
    expect(css).toContain('.hud[data-layout="desk"] .hud-command .hud-dot { min-width: 26px; min-height: 26px; }');
    expect(css).toContain('.hud[data-layout="desk"] .hud-command:has(.hud-predict:not([hidden])) > .hud-stage { display: none; }');
    expect(css).toContain('.hud-predict .hud-line { margin: 0; }');
  });

  it('the seal row is reserved while there is something to choose, so the buttons do not jump when a choice is sent', () => {
    expect(css).toContain('.hud-seal[data-empty="true"] { visibility: hidden; }');
    expect(panel).toContain("view.seal !== undefined || view.choices.length > 0");
  });

  it('every scrollable area of the HUD uses the gilt tokens for its bar', () => {
    expect(css).toContain('.hud * { scrollbar-width: thin; scrollbar-color: var(--hud-gilt-dim) var(--hud-umber); }');
  });

  it('on the desk the round banner rides high, away from the command panel', () => {
    expect(css).toContain('.hud[data-layout="desk"] .hud-banner { align-items: flex-start; padding-top: max(150px, 22vh);');
  });
});

describe('second screenshot pass: small items', () => {
  it('the watch button and an error line have room above them; the share row stays on one line on the desk', () => {
    expect(join).toContain("'hud-btn hud-watch'");
    expect(css).toContain('.hud-watch { margin-top: 12px; }');
    expect(css).toContain('.hud-card .hud-messages:not(:empty) { margin-top: 8px; }');
    expect(css).toContain('.hud[data-layout="desk"] .hud-link { flex-wrap: nowrap; }');
    expect(css).toContain('.hud-link .hud-btn { flex: none; }');
  });

  it('the footer links are touch targets on the phone', () => {
    expect(css).toContain('.hud[data-layout="phone"] .hud-tools a { min-height: 44px; min-width: 44px; }');
  });

  it('capturing the pointer on the minimap cannot throw for a pointer that is gone', () => {
    const at = panel.indexOf('miniBox.setPointerCapture(event.pointerId);');
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(Math.max(0, at - 20), at)).toContain('try {');
    expect(panel.slice(at, at + 80)).toContain('} catch {');
  });
});

describe('third screenshot pass: one control row, one-line result, stable panels', () => {
  it('the five controls have a short face; the full words are the accessible name and the tooltip', () => {
    expect(panel).toContain('function navButton(');
    expect(panel).toMatch(/node\.setAttribute\('aria-label', full\)/);
    expect(panel).toMatch(/node\.title = full/);
    for (const key of ['controlFirstShort', 'controlPreviousShort', 'controlNextShort', 'controlLastShort', 'controlResetShort']) expect(panel, key).toContain(`STRINGS.${key}`);
  });

  it('the dots and the buttons never wrap: one row on the phone and on the desk, and the Partida pane does not scroll', () => {
    expect(panel).toMatch(/el\('div', 'hud-controls', command\)/);
    expect(panel).toMatch(/el\('div', 'hud-track', controls\)/);
    expect(panel).toMatch(/el\('div', 'hud-nav', controls\)/);
    expect(css).toContain('.hud-controls { display: flex; align-items: center; flex-wrap: nowrap;');
    expect(css).toContain('margin-top: auto; }');
    expect(css).toContain('.hud-controls > .hud-nav { flex: 1 1 auto; justify-content: flex-end; flex-wrap: nowrap;');
    expect(css).toContain('.hud-controls > .hud-track { flex: 0 1 auto; flex-wrap: nowrap; }');
    expect(css).toContain('.hud[data-layout="phone"] .hud-command { padding: 0; gap: 6px; min-height: 212px; }');
    expect(css).toMatch(/\.hud\[data-layout="phone"\] \.hud-pane:not\(\[hidden\]\):has\(> \.hud-command\) \{ display: flex; flex-direction: column; overflow: hidden; \}/);
  });

  it('the result is one line and the seal sits on the head row, so a result never grows the desk panel', () => {
    expect(css).toMatch(/\.hud-result \{ display: flex; align-items: baseline;[^}]*white-space: nowrap; overflow: hidden;/);
    expect(css).toContain('.hud-predict .hud-seal { position: absolute;');
    expect(css).toContain('.hud[data-layout="desk"] .hud-result > p:nth-of-type(3) { display: none; }');
  });
});
