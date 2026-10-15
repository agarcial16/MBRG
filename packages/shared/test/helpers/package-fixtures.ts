/** Fixtures for the map package contract tests (spec 003a). Extended by later tasks. */

/** The 66 noncharacters of FR-87 rule 7. */
export function noncharacters(): number[] {
  const list: number[] = [];
  for (let c = 0xfdd0; c <= 0xfdef; c++) list.push(c);
  for (let plane = 0; plane <= 16; plane++) {
    list.push(plane * 0x10000 + 0xfffe, plane * 0x10000 + 0xffff);
  }
  return list;
}

/** A text of `count` code points, all astral (2 code units each). */
export function astral(count: number): string {
  return String.fromCodePoint(0x1f600).repeat(count);
}
