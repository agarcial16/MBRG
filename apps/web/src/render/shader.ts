// GLSL ES 3.00 sources (FR-136 to FR-140). The fragment shader is a line-by-line port of `shade` in
// `core/borders.ts`, which is the normative rule: same names, same order of tests, same tie-break bias.
// It reads the id image with texelFetch only (no filtering, FR-134) and computes every position
// relative to the camera, so float32 keeps its precision at the largest scale (plan section 15).
// While a colour front is on (`uFrontOn`), the same shader is a line-by-line port of `shadeTransition` in
// `core/transition-shade.ts` (FR-179, FR-180): same names, same order of tests, same comparison in float32.
import { BORDER_PRIORITY, EDGE_BIAS, WIDTH_LEVELS } from '../core/borders';
import { TRANSITION_PRIORITY } from '../core/transition-shade';

/** One full-screen quad: positions are already clip-space coordinates. */
export const VERTEX_SHADER = `in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Border class constants numbered in the priority order of the reference (lowest number wins). */
const CLASS_CONSTANTS = BORDER_PRIORITY.map((name, i) => `const int C_${name.toUpperCase().replace('-', '_')} = ${i};`).join('\n');

const classConstant = (name: string): string => name.toUpperCase().replace('-', '_');

/** Step border classes numbered in the order of TRANSITION_PRIORITY (lowest number wins). */
const STEP_CONSTANTS = TRANSITION_PRIORITY.map((name, i) => `const int S_${classConstant(name)} = ${i};`).join('\n');

/** Width and colour of a step class are those of its base class; `absorbed` has the width of `faction`. */
const BASE_OF_STEP = TRANSITION_PRIORITY.map((name) => BORDER_PRIORITY.indexOf(name === 'absorbed' ? 'faction' : name));
/** The step class of each base class. */
const STEP_OF_BASE = BORDER_PRIORITY.map((name) => TRANSITION_PRIORITY.indexOf(name));

/** The width levels of the reference, widest first, as GLSL float literals: `4.0, 2.0, 1.0`. */
const WIDTH_LIST = WIDTH_LEVELS.map((w) => w.toFixed(1)).join(', ');

export const FRAGMENT_SHADER = `precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uIndex;   // RG8: entry index of every map unit (low byte in R)
uniform sampler2D uKinds;   // R8, per entry: 0 outside, 1 land, 2 sea
uniform sampler2D uOwners;  // R8, per entry: faction index of the owner (0 none)
uniform sampler2D uColors;  // RGBA8, per faction index: fill colour
uniform vec2 uImage;        // id image size in map units
uniform vec2 uCenterCell;   // floor of the camera centre, in map units
uniform vec2 uCenterFrac;   // camera centre minus uCenterCell, in [0, 1)
uniform vec2 uViewport;     // drawing area in CSS pixels
uniform vec2 uDevice;       // drawing surface in device pixels
uniform float uScale;       // screen (CSS) pixels per map unit
uniform float uDpr;         // device pixels per CSS pixel
uniform vec3 uSea;
uniform vec3 uOutside;
uniform vec3 uBorderColors[${BORDER_PRIORITY.length}];
uniform float uWidths[${BORDER_PRIORITY.length}];
uniform float uTerritoryOpacity;
uniform float uTerritoryDarken;
uniform sampler2D uOwnersBefore; // R8, per entry: faction index of the owner at the earlier state of a step
uniform sampler2D uFront;   // R32F, normalised front distance of the units of the moving pieces
uniform vec4 uFrontBox;     // x0, y0, width, height of the front texture, in map units
uniform int uFrontOn;       // 1 while a front is drawn, 0 for the plain drawing
uniform float uProgress;    // forward fraction f of the step, in [0, 1)

layout(location = 0) out highp vec4 outColor;

${CLASS_CONSTANTS}
${STEP_CONSTANTS}
const int BASE_OF_STEP[${BASE_OF_STEP.length}] = int[${BASE_OF_STEP.length}](${BASE_OF_STEP.join(', ')});
const int STEP_OF_BASE[${STEP_OF_BASE.length}] = int[${STEP_OF_BASE.length}](${STEP_OF_BASE.join(', ')});
const float EDGE_BIAS = ${EDGE_BIAS.toFixed(8)};
const float WIDTH_LEVELS[${WIDTH_LEVELS.length}] = float[${WIDTH_LEVELS.length}](${WIDTH_LIST});

int byteAt(sampler2D table, int i) {
  return int(floor(texelFetch(table, ivec2(i, 0), 0).r * 255.0 + 0.5));
}

// Entry index at a whole map position; outside the image is 0.
int cellAt(ivec2 cell) {
  if (cell.x < 0 || cell.y < 0 || float(cell.x) >= uImage.x || float(cell.y) >= uImage.y) return 0;
  vec2 t = texelFetch(uIndex, cell, 0).rg;
  return int(floor(t.r * 255.0 + 0.5)) + 256 * int(floor(t.g * 255.0 + 0.5));
}

// Border class of the edge between entries a and b, or -1 when there is none. Owners by index.
int borderClassOf(int a, int b) {
  if (a == b) return -1;
  int fa = byteAt(uKinds, a);
  int fb = byteAt(uKinds, b);
  if (fa == 0 && fb == 0) return -1;
  if (fa == 1 && fb == 1) return byteAt(uOwners, a) != byteAt(uOwners, b) ? C_FACTION : C_TERRITORY;
  if (fa == 0) return fb == 1 ? C_OUTER : C_SHORE;
  if (fb == 0) return fa == 1 ? C_OUTER : C_SHORE;
  if (fa == 2 && fb == 2) return C_SEA_ZONE;
  return C_COAST;
}

// Normalised front distance at a whole map position, or -1 outside the front box.
float frontAtCell(ivec2 cell) {
  ivec2 c = cell - ivec2(uFrontBox.xy);
  if (c.x < 0 || c.y < 0 || c.x >= int(uFrontBox.z) || c.y >= int(uFrontBox.w)) return -1.0;
  return texelFetch(uFront, c, 0).r;
}

// Step class of the edge between entries a and b, or -1 when there is none. Land pairs: after the step,
// owners differing is a faction edge; same owner now but not before is the edge of the absorbed area.
int stepClassOf(int a, int b) {
  if (a == b) return -1;
  if (byteAt(uKinds, a) == 1 && byteAt(uKinds, b) == 1) {
    if (byteAt(uOwners, a) != byteAt(uOwners, b)) return S_FACTION;
    return byteAt(uOwnersBefore, a) == byteAt(uOwnersBefore, b) ? S_TERRITORY : S_ABSORBED;
  }
  int c = borderClassOf(a, b);
  return c < 0 ? -1 : STEP_OF_BASE[c];
}

// Fill colour of a faction on the 0..255 scale.
vec3 factionRgb(int faction) {
  return floor(texelFetch(uColors, ivec2(faction, 0), 0).rgb * 255.0 + 0.5);
}

// Colour of a territory line over the owner colour (0..255 scale): floor(c x darken).
vec3 territoryRgb(int faction) {
  return floor(factionRgb(faction) * uTerritoryDarken);
}

void main() {
  // CSS position of this pixel centre, from the top-left of the drawing area.
  vec2 f = vec2(gl_FragCoord.x, uDevice.y - gl_FragCoord.y) / uDpr;
  // Map point relative to the camera cell: q = centre fraction + offset from the centre.
  vec2 q = uCenterFrac + (f - uViewport * 0.5) / uScale;
  ivec2 base = ivec2(uCenterCell);
  int a = cellAt(base + ivec2(floor(q)));
  int fillKind = byteAt(uKinds, a);

  vec3 fillColor = uOutside;
  if (fillKind == 1) {
    int owner = byteAt(uOwners, a);
    if (uFrontOn != 0) {
      // A moving unit keeps the earlier owner's colour until the front reaches it.
      int ownerBefore = byteAt(uOwnersBefore, a);
      if (ownerBefore != owner) {
        float d = frontAtCell(base + ivec2(floor(q)));
        if (!(d < uProgress)) owner = ownerBefore;
      }
    }
    fillColor = texelFetch(uColors, ivec2(owner, 0), 0).rgb;
  } else if (fillKind == 2) {
    fillColor = uSea;
  }

  const vec2 DIRS[4] = vec2[4](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0));
  int found = 0;
  int foundStep = 0;
  for (int wi = 0; wi < ${WIDTH_LEVELS.length}; wi++) {
    float w = WIDTH_LEVELS[wi];
    for (int di = 0; di < 4; di++) {
      vec2 dir = DIRS[di];
      float o = (w * 0.5 + (dir.x + dir.y) * EDGE_BIAS) / uScale;
      int b = cellAt(base + ivec2(floor(q + dir * o)));
      int c = borderClassOf(a, b);
      if (c >= 0 && uWidths[c] == w) found |= (1 << c);
      if (uFrontOn != 0) {
        int sc = stepClassOf(a, b);
        if (sc >= 0 && uWidths[BASE_OF_STEP[sc]] == w) foundStep |= (1 << sc);
      }
    }
  }
  int border = -1;
  for (int c = 0; c < ${BORDER_PRIORITY.length}; c++) {
    if ((found & (1 << c)) != 0) {
      border = c;
      break;
    }
  }
  int stepBorder = -1;
  for (int c = 0; c < ${TRANSITION_PRIORITY.length}; c++) {
    if ((foundStep & (1 << c)) != 0) {
      stepBorder = c;
      break;
    }
  }

  vec3 color = fillColor;
  if (uFrontOn != 0) {
    vec3 fill255 = floor(fillColor * 255.0 + 0.5);
    if (stepBorder == S_ABSORBED) {
      // From the faction line colour to the territory line over the absorber, fading to the territory opacity.
      vec3 lineFrom = floor(uBorderColors[C_FACTION] * 255.0 + 0.5);
      vec3 lineTo = territoryRgb(byteAt(uOwners, a));
      vec3 line = lineFrom + (lineTo - lineFrom) * uProgress;
      float alpha = 1.0 + (uTerritoryOpacity - 1.0) * uProgress;
      color = floor(fill255 * (1.0 - alpha) + line * alpha + 0.5) / 255.0;
    } else if (stepBorder == S_TERRITORY) {
      vec3 lineFrom = territoryRgb(byteAt(uOwnersBefore, a));
      vec3 lineTo = territoryRgb(byteAt(uOwners, a));
      vec3 line = lineFrom + (lineTo - lineFrom) * uProgress;
      color = floor(fill255 * (1.0 - uTerritoryOpacity) + line * uTerritoryOpacity + 0.5) / 255.0;
    } else if (stepBorder >= 0) {
      color = uBorderColors[BASE_OF_STEP[stepBorder]];
    }
  } else if (border == C_TERRITORY) {
    vec3 fill255 = floor(fillColor * 255.0 + 0.5);
    vec3 line = floor(fill255 * uTerritoryDarken);
    color = floor(fill255 * (1.0 - uTerritoryOpacity) + line * uTerritoryOpacity + 0.5) / 255.0;
  } else if (border >= 0) {
    color = uBorderColors[border];
  }
  outColor = vec4(color, 1.0);
}
`;
