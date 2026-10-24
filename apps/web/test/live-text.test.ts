import { describe, expect, it } from 'vitest';
import { HALT_REASONS, STAGES, type PublicSchedule, type Stage } from '@mbrg/protocol';
import {
  connectionNotice,
  countdownText,
  errorText,
  formatCountdown,
  haltText,
  liveTitle,
  nextAnchor,
  roundLine,
  stageText,
  victimLine,
  winnerLine,
  type LiveErrorKind,
} from '../src/core/live-text';
import { STRINGS } from '../src/core/strings';
import { codeOnly, languageViolations, stripComments } from './helpers/scan';

const SCHEDULE: PublicSchedule = { c1: 100_000, c2: 160_000, a: 190_000 };
const CLOCK = { i: 120, l1: 30, l2: 10 } as const;
const nameOf = (id: number): string => `Faccion ${id}`;

describe('FR-305 the stage and the round', () => {
  it('FR-305 the five stages have five different Spanish texts, all from the strings module', () => {
    const texts = STAGES.map((stage) => stageText(stage));
    expect(new Set(texts).size).toBe(5);
    expect(texts).toStrictEqual([
      STRINGS.liveStagePhase1,
      STRINGS.liveStagePhase2,
      STRINGS.liveStageLocked,
      STRINGS.liveStageFinished,
      STRINGS.liveStageHalted,
    ]);
    for (const text of texts) expect(text.trim().length).toBeGreaterThan(0);
  });

  it('FR-305 the title and the round line come from the strings module', () => {
    expect(liveTitle()).toBe(STRINGS.liveTitle);
    expect(roundLine(3, 8)).toBe('Ronda 3 de 8');
  });
});

describe('FR-305 the countdown', () => {
  it('FR-305 the format is M:SS below one hour and H:MM:SS from one hour', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1000)).toBe('0:01');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(754_000)).toBe('12:34');
    expect(formatCountdown(3_599_000)).toBe('59:59');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(36_000_000 + 5 * 60_000 + 9000)).toBe('10:05:09');
  });

  it('FR-305 the seconds are rounded up, so 0:00 is shown only when the step is due', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(1001)).toBe('0:02');
    expect(formatCountdown(59_001)).toBe('1:00');
  });

  it('FR-305 the countdown is never negative', () => {
    expect(formatCountdown(-1)).toBe('0:00');
    expect(formatCountdown(-86_400_000)).toBe('0:00');
    expect(countdownText('phase-1', CLOCK, SCHEDULE, 999_999_999)).toContain('0:00');
    expect(countdownText('phase-1', CLOCK, SCHEDULE, 999_999_999)).not.toContain('-');
  });

  it('FR-305 (FR-302 client estimate) the anchor is C1 in phase-1, C2 in phase-2 and A in locked, from the reported-time estimate', () => {
    expect(nextAnchor('phase-1', SCHEDULE)).toBe(100_000);
    expect(nextAnchor('phase-2', SCHEDULE)).toBe(160_000);
    expect(nextAnchor('locked', SCHEDULE)).toBe(190_000);
    expect(countdownText('phase-1', CLOCK, SCHEDULE, 40_000)).toBe('Próximo paso en 1:00');
    expect(countdownText('phase-2', CLOCK, SCHEDULE, 100_000)).toBe('Próximo paso en 1:00');
    expect(countdownText('locked', CLOCK, SCHEDULE, 188_500)).toBe('Próximo paso en 0:02');
    expect(countdownText('phase-1', CLOCK, SCHEDULE, 100_000 - 3_723_000)).toBe('Próximo paso en 1:02:03');
  });

  it('FR-305 there is no countdown with timing manual, without a schedule, or outside the running stages', () => {
    expect(countdownText('phase-1', 'manual', SCHEDULE, 0)).toBeUndefined();
    expect(countdownText('phase-2', 'manual', undefined, 0)).toBeUndefined();
    expect(countdownText('phase-1', CLOCK, undefined, 0)).toBeUndefined();
    for (const stage of ['finished', 'halted'] as const) {
      expect(nextAnchor(stage, SCHEDULE)).toBeUndefined();
      expect(countdownText(stage, CLOCK, SCHEDULE, 0)).toBeUndefined();
    }
  });
});

describe('FR-305 the victim, the winner and the halt', () => {
  it('FR-305 the victim line is shown at once in phase-2, locked and halted after a reveal (D19), and nowhere else', () => {
    const shown: Stage[] = ['phase-2', 'locked', 'halted'];
    for (const stage of STAGES) {
      const line = victimLine(stage, 7, nameOf);
      if (shown.includes(stage)) expect(line, stage).toBe('Víctima de la ronda: Faccion 7.');
      else expect(line, stage).toBeUndefined();
    }
  });

  it('FR-305 no victim known means no victim line, even in phase-2 or in a halted match without a reveal', () => {
    expect(victimLine('phase-2', undefined, nameOf)).toBeUndefined();
    expect(victimLine('halted', undefined, nameOf)).toBeUndefined();
  });

  it('FR-305 the winner line is shown only when finished', () => {
    for (const stage of STAGES) {
      const line = winnerLine(stage, 4, nameOf);
      if (stage === 'finished') expect(line).toBe('Ganadora de la partida: Faccion 4.');
      else expect(line, stage).toBeUndefined();
    }
    expect(winnerLine('finished', undefined, nameOf)).toBeUndefined();
  });

  it('FR-305 each halt reason has its own Spanish text', () => {
    const texts = HALT_REASONS.map((reason) => haltText(reason));
    expect(new Set(texts).size).toBe(HALT_REASONS.length);
    expect(texts).toStrictEqual([STRINGS.liveHaltMapChanged, STRINGS.liveHaltIsolatedFaction, STRINGS.liveHaltVictimMismatch]);
  });
});

describe('NFR-56 the connection notice and the errors of the live scene', () => {
  it('NFR-56 the connection notice shows the time left until the next attempt', () => {
    expect(connectionNotice(31_000, 1000)).toBe(
      'Sin conexión con el servidor. Se conserva el último estado. Próximo intento en 0:30.',
    );
    expect(connectionNotice(5000, 6000)).toContain('0:00');
    expect(connectionNotice(5000, 6000)).not.toContain('{');
  });

  it('FR-306 (messages) every error of the live scene has its own Spanish text from the strings module', () => {
    const kinds: LiveErrorKind[] = ['unknown-match', 'digest-mismatch', 'insecure-origin', 'both', 'need-match', 'bad-match'];
    const texts = kinds.map((kind) => errorText(kind));
    expect(new Set(texts).size).toBe(6);
    expect(texts).toStrictEqual([
      STRINGS.liveErrorUnknownMatch,
      STRINGS.liveErrorDigestMismatch,
      STRINGS.liveErrorInsecureOrigin,
      STRINGS.liveErrorBoth,
      STRINGS.liveErrorNeedMatch,
      STRINGS.liveErrorBadMatch,
    ]);
    expect(errorText('insecure-origin')).toMatch(/segura/);
    for (const text of texts) expect(text).not.toMatch(/\{\w+\}/);
  });
});

const live = import.meta.glob('../src/core/live-*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('NFR-56 the live texts are Spanish and live in the strings module', () => {
  it('NFR-56 the scan sees the live core sources (not vacuous)', () => {
    expect(Object.keys(live)).toEqual(expect.arrayContaining(['../src/core/live-address.ts', '../src/core/live-text.ts']));
  });

  it('NFR-56 no live source holds a Spanish text of its own: no DOM text sink literal, only ASCII', () => {
    for (const [path, src] of Object.entries(live)) expect(languageViolations(src), path).toStrictEqual([]);
  });

  it('NFR-56 the language scan flags a Spanish literal planted in a live source', () => {
    for (const [path, src] of Object.entries(live)) {
      expect(languageViolations(`${src}\nel.textContent = 'Fin de la partida';`), path).not.toStrictEqual([]);
      expect(languageViolations(`${src}\nconst t = 'Partida detenida á';`), path).toContain('non-ASCII character');
    }
  });

  it('NFR-56 every string of the live viewer is a non-empty Spanish sentence with known placeholders', () => {
    const keys = Object.keys(STRINGS).filter((k) => k.startsWith('live'));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) {
      const text = STRINGS[key as keyof typeof STRINGS];
      expect(text.trim().length, key).toBeGreaterThan(0);
      for (const m of text.matchAll(/\{(\w+)\}/g)) expect(['time', 'name', 'text', 'round', 'param'], `${key} ${m[1]}`).toContain(m[1]);
    }
  });

  it('NFR-56 every live string key is used by a live core source', () => {
    const code = Object.values(live)
      .map((src) => codeOnly(stripComments(src)))
      .join('\n');
    for (const key of Object.keys(STRINGS).filter((k) => k.startsWith('live'))) {
      expect(new RegExp(`\\bSTRINGS\\s*\\.\\s*${key}\\b`).test(code), `STRINGS.${key} is unused by the live core`).toBe(true);
    }
  });
});
