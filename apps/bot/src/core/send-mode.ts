// Embed or plain text (spec 017 FR-475): without the channel permission Embed Links the same announcement goes as the plain text of 012,
// and the operator is warned once per channel (until the permission is granted again). Pure: the shell reads the permission and keeps `warned`.

export interface SendMode {
  readonly mode: 'embed' | 'text';
  /** True only the first time a channel is found without the permission. */
  readonly warn: boolean;
  /** What to remember for the channel after this decision. */
  readonly warned: boolean;
}

export function sendMode(canEmbed: boolean, warnedBefore: boolean): SendMode {
  if (canEmbed) return { mode: 'embed', warn: false, warned: false };
  return { mode: 'text', warn: !warnedBefore, warned: true };
}
