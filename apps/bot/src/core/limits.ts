// Discord's own limits (spec 012 NFR-91, spec 017 NFR-94) and the cuts that respect them. Pure.
import type { EmbedSpec } from './model';

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

/** Discord's embed limits (spec 017 NFR-94). */
export const EMBED_LIMITS = Object.freeze({ title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 });

/** The embed cut to Discord's limits: each part to its own, at most 25 fields, then fields and description shortened until the total fits. */
export function fitEmbed(embed: EmbedSpec): EmbedSpec {
  const L = EMBED_LIMITS;
  let description = embed.description === undefined ? undefined : clip(embed.description, L.description);
  let fields = embed.fields.slice(0, L.fields).map((f) => ({ name: clip(f.name, L.fieldName), value: clip(f.value, L.fieldValue) }));
  const title = clip(embed.title, L.title);
  const footer = embed.footer === undefined ? undefined : clip(embed.footer, L.footer);
  const size = (): number => title.length + (description?.length ?? 0) + (footer?.length ?? 0) + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  while (size() > L.total && fields.length > 0) fields = fields.slice(0, -1);
  if (description !== undefined && size() > L.total) description = clip(description, Math.max(0, description.length - (size() - L.total)));
  return { color: embed.color, title, ...(description === undefined ? {} : { description }), fields, ...(footer === undefined ? {} : { footer }) };
}
