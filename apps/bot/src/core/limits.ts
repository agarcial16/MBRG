// Discord's own limits (spec 012 NFR-91) and the cuts that respect them. Pure.

export const DISCORD = Object.freeze({
  messageChars: 2000,
  buttonsPerRow: 5,
  optionsPerMenu: 25,
  labelChars: 100,
});

/** The text cut to `max` characters, the last one a dot when something was removed. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}.`;
}

/** The text as messages of at most `max` characters: cut at line ends where it can, inside a line only when one is too long. */
export function splitMessage(text: string, max: number = DISCORD.messageChars): string[] {
  const parts: string[] = [];
  let current = '';
  const flush = (): void => {
    parts.push(current);
    current = '';
  };
  let started = false;
  for (const line of text.split('\n')) {
    if (started && current.length + 1 + line.length <= max) {
      current += `\n${line}`;
      continue;
    }
    if (started) flush();
    started = true;
    let rest = line;
    while (rest.length > max) {
      parts.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    current = rest;
  }
  flush();
  return parts;
}

/** The items in rows of at most five (a message holds at most five rows; the caller never offers more than 25 buttons). */
export function rowsOf<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += DISCORD.buttonsPerRow) rows.push(items.slice(i, i + DISCORD.buttonsPerRow));
  return rows;
}
