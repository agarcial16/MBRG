import { describe, expect, it } from 'vitest';
import { DEBUG_TITLE } from '../src/core/scene';
import { STRINGS } from '../src/core/strings';
import { codeOnly, stripComments } from './helpers/scan';

// FR-159 (the rendering part knows no seed, round or sim), FR-161 (the seed goes nowhere),
// FR-155 (no animation). Scans over the viewer sources, as in 001 NFR-4 and the 002 purity scan.
const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(all).map(([path, src]) => [path.replace('../src/', ''), src] as const);
const render = sources.filter(([path]) => path.startsWith('render/'));
const nonRender = sources.filter(([path]) => !path.startsWith('render/'));

/** Import specifiers of a source (static, dynamic and type imports). */
function specifiers(src: string): string[] {
  return [...stripComments(src).matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

const SIM_SPECIFIER = /^@mbrg\/sim(\/|$)/;
const SCENE_SIDE_MODULE = /(^|\/)(scene|address|navigation|perf)$/;

/** Violations of the FR-159 rule in one source of the rendering part. */
function renderViolations(src: string): string[] {
  const found: string[] = [];
  for (const spec of specifiers(src)) {
    if (SIM_SPECIFIER.test(spec)) found.push(`imports the sim: ${spec}`);
    if (SCENE_SIDE_MODULE.test(spec) || /(^|\/)ui(\/|$)/.test(spec)) found.push(`imports a scene or UI module: ${spec}`);
  }
  // Identifiers: nothing named after a seed or a round (Math.round is arithmetic, not a round).
  const code = codeOnly(src).replace(/\bMath\s*\.\s*round\b/g, '');
  for (const m of code.matchAll(/\b\w*(?:seed|round)\w*\b/gi)) found.push(`identifier ${m[0]}`);
  for (const m of code.matchAll(/\b(RoundRecord|MatchState|SimPort)\b/g)) found.push(`type ${m[1]}`);
  // Shader sources are strings: a seed must not be mentioned there either (GLSL has a round() function).
  if (/seed/i.test(stripComments(src))) found.push('seed in text');
  return found;
}

describe('FR-159 the rendering part takes no seed, round or sim', () => {
  it('FR-159 the sources under src/render import no sim package and name no seed, round or round record', () => {
    for (const [path, src] of render) expect(renderViolations(src), path).toStrictEqual([]);
  });

  it('FR-159 the scan flags each kind of planted violation', () => {
    const planted = [
      "import { getState } from '@mbrg/sim';",
      "import type { RoundRecord } from '@mbrg/sim';",
      "import { sceneAt } from '../core/scene';",
      "import { parseAddress } from '../core/address';",
      "import { navigate } from '../core/navigation';",
      "import { main } from '../ui/main';",
      'export function draw(seed: number) {}',
      'const currentRound = 3;',
      'function setRound(n: number) {}',
      'let rounds = [];',
      'type X = RoundRecord;',
      'type Y = MatchState;',
      "const glsl = 'uniform float uSeed;';",
      'const total = totalRounds;',
    ];
    for (const src of planted) expect(renderViolations(src), src).not.toStrictEqual([]);
  });

  it('FR-159 the scan lets rendering code through', () => {
    const fine = [
      "import { Scene } from 'three';",
      "import { renderReference } from '../core/borders';",
      "import type { Camera } from '../core/camera';",
      'const x = Math.round(v * 2) / 2;',
      "// seed and round only in a comment",
      "const frag = 'float i = round(texel.r * 255.0);';",
      "export function draw(owners: Uint8Array, cam: Camera) {}",
    ];
    for (const src of fine) expect(renderViolations(src), src).toStrictEqual([]);
  });

  it('FR-159 the scan detects real scene code (it would flag src/core/scene.ts if that sat in src/render)', () => {
    const scene = sources.find(([path]) => path === 'core/scene.ts');
    expect(scene).toBeDefined();
    expect(renderViolations(scene![1]).length).toBeGreaterThan(0);
  });

  it('FR-159 only src/core/scene.ts (types) and the startup src/ui/main.ts (the real sim handed to the scene) mention the sim package', () => {
    const mentioning = sources.filter(([, src]) => specifiers(src).some((s) => SIM_SPECIFIER.test(s))).map(([path]) => path);
    expect(mentioning).toStrictEqual(['core/scene.ts', 'ui/main.ts']);
    const scene = sources.find(([path]) => path === 'core/scene.ts')![1];
    const runtime = stripComments(scene)
      .split(';')
      .filter((statement) => /from\s*['"]@mbrg\/sim['"]/.test(statement) && !/^\s*import\s+type\b/.test(statement));
    expect(runtime).toStrictEqual([]);
  });

  it('FR-159 no module imports the scene module except the UI shell (the rendering part cannot reach the sim through it)', () => {
    for (const [path, src] of sources) {
      if (path.startsWith('ui/')) continue;
      expect(specifiers(src).filter((s) => /(^|\/)scene$/.test(s)), path).toStrictEqual([]);
    }
  });
});

const NETWORK_NAMES = /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|serviceWorker|SharedWorker|Worker|WebTransport|RTCPeerConnection)\b/;
const NAVIGATION = /\b(?:location|window\s*\.\s*location)\s*\.\s*(?:assign|replace|reload|href\s*=(?!=)|search\s*=(?!=)|hash\s*=(?!=))|\bwindow\s*\.\s*open\b|\bnew\s+Image\b|\.\s*src\s*=(?!=)|\.\s*href\s*=(?!=)/;

/** Network use in one source; `fetch(` is allowed only in `ui/load.ts`. */
function networkViolations(path: string, src: string): string[] {
  const code = codeOnly(src);
  const found: string[] = [];
  const named = NETWORK_NAMES.exec(code);
  if (named) found.push(`network API ${named[1]}`);
  if (/\bfetch\s*\(/.test(code) && path !== 'ui/load.ts') found.push('fetch outside ui/load.ts');
  if (NAVIGATION.test(code)) found.push('navigation or resource request');
  return found;
}

describe('FR-161 the seed of the debug scene goes nowhere', () => {
  it('FR-161 the scan sees the sources (not vacuous)', () => {
    expect(sources.map(([p]) => p)).toContain('ui/load.ts');
    expect(sources.length).toBeGreaterThanOrEqual(15);
    expect(nonRender.length).toBe(sources.length - render.length);
  });

  it('FR-161 no source uses a network API; fetch( appears only in ui/load.ts', () => {
    for (const [path, src] of sources) expect(networkViolations(path, src), path).toStrictEqual([]);
    const loader = sources.find(([p]) => p === 'ui/load.ts')![1];
    expect(/\bfetch\b/.test(codeOnly(loader))).toBe(true);
  });

  it('FR-161 the loader names no seed or round, so the package request cannot carry one', () => {
    const loader = sources.find(([p]) => p === 'ui/load.ts')![1];
    expect(/seed|round/i.test(stripComments(loader))).toBe(false);
  });

  it('FR-161 the scan flags each kind of planted network or navigation use', () => {
    const planted = [
      'const r = await fetch(u + seed);',
      'const x = new XMLHttpRequest();',
      "const s = new WebSocket('wss://x');",
      "const e = new EventSource('/x');",
      "navigator.sendBeacon('/x', seed);",
      "importScripts('x.js');",
      'const w = new Worker(u);',
      'location.assign(u);',
      'location.reload();',
      'window.location.href = u;',
      'location.href = u;',
      "window.open('x');",
      'new Image().src = u;',
      'img.src = u;',
      'navigator.serviceWorker.register(u);',
    ];
    for (const src of planted) expect(networkViolations('core/x.ts', src), src).not.toStrictEqual([]);
    expect(networkViolations('ui/load.ts', 'const r = await fetch(u);')).toStrictEqual([]);
    expect(networkViolations('ui/main.ts', 'const r = await fetch(u);')).not.toStrictEqual([]);
  });

  it('FR-161 the scan lets plain code through', () => {
    const fine = [
      "// fetch( and WebSocket in a comment",
      "const t = 'location.href = x';",
      'const same = a.href === b.href;',
      'history.replaceState(null, "", url);',
      'const loc = location.search;',
    ];
    for (const src of fine) expect(networkViolations('ui/url.ts', src), src).toStrictEqual([]);
  });

  it('FR-161 the debug scene is labelled by the UI title string', () => {
    expect(DEBUG_TITLE).toBe(STRINGS.debugTitle);
    expect(STRINGS.debugTitle.length).toBeGreaterThan(0);
  });
});

const TIMERS = /\b(setTimeout|setInterval|transition|transitions|animate|animation|animations|tween|tweens|keyframes|lerp|requestIdleCallback)\b/i;
const TIME_UNIFORM = /\buniform\b[^;]*\b(?:u_?time|time|iTime|uProgress|progress|uMix|mix_?factor)\b/i;

/** Animation machinery in one source; `requestAnimationFrame` is allowed only in the UI shell. */
function animationViolations(path: string, src: string): string[] {
  const found: string[] = [];
  const code = codeOnly(src);
  const timer = TIMERS.exec(code);
  if (timer) found.push(`timer or animation ${timer[1]}`);
  if (!path.startsWith('ui/') && /\b(requestAnimationFrame|cancelAnimationFrame)\b/.test(code)) found.push('animation frame outside ui');
  // Shader sources are strings: look at them as text.
  const text = stripComments(src);
  const uniform = TIME_UNIFORM.exec(text);
  if (uniform) found.push(`time uniform ${uniform[1]}`);
  if (/\bgl_FragColor\b[^;]*\bmix\b[^;]*\b(?:old|prev|previous)/i.test(text)) found.push('frame mixing');
  return found;
}

describe('FR-155 a round change is drawn at once, without animation', () => {
  it('FR-155 no source has timers, transitions, tweens or time uniforms; animation frames only in src/ui', () => {
    for (const [path, src] of sources) expect(animationViolations(path, src), path).toStrictEqual([]);
  });

  it('FR-155 the scan flags planted animation machinery', () => {
    const planted: [string, string][] = [
      ['ui/main.ts', 'setTimeout(draw, 100);'],
      ['ui/main.ts', 'setInterval(draw, 100);'],
      ['render/renderer.ts', 'requestAnimationFrame(loop);'],
      ['core/scene.ts', 'cancelAnimationFrame(h);'],
      ['render/map-scene.ts', 'el.style.transition = x;'],
      ['render/map-scene.ts', 'const a = tween(from, to);'],
      ['render/map-scene.ts', 'const a = lerp(from, to, t);'],
      ['render/shader.ts', "const s = 'uniform float uTime;';"],
      ['render/shader.ts', "const s = 'uniform float u_progress; uniform float progress;';"],
      ['ui/panel.ts', 'el.animate(frames, 200);'],
    ];
    for (const [path, src] of planted) expect(animationViolations(path, src), `${path}: ${src}`).not.toStrictEqual([]);
    expect(animationViolations('ui/input.ts', 'requestAnimationFrame(loop);')).toStrictEqual([]);
  });

  it('FR-155 the scan lets drawing code through', () => {
    const fine = [
      'renderer.render(scene, camera);',
      "const s = 'uniform vec4 uView; uniform float uOpacity;';",
      '// no setTimeout here',
    ];
    for (const src of fine) expect(animationViolations('render/renderer.ts', src), src).toStrictEqual([]);
  });
});
