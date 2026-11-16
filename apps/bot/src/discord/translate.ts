// The translation between Discord's shapes and the core's (spec 012 NFR-90). Pure functions over plain values: the thin shell
// reads the discord.js objects, calls these and sends what they return. Nothing here imports the Discord library; the payloads
// are the raw API shapes (numeric component and button types) that the library sends as they are.
import type { BoardEntryView, Interaction } from '../core/actions';
import { fitEmbed, rowsOf, splitMessage } from '../core/limits';
import type { ButtonSpec, EmbedSpec, OutMessage, Reply } from '../core/model';
import { STRINGS } from '../core/strings';

const ACTION_ROW = 1;
const BUTTON = 2;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
const BUTTON_STYLE = { primary: 1, success: 3, link: 5 } as const;
const SHORT = 1;
/** The message flag that makes a reply visible only to the member. */
export const EPHEMERAL = 64;

/** The core interaction of a slash command, from the subcommand name and its text options. */
export function fromCommand(sub: string, options: { readonly map?: string | null; readonly pace?: string | null; readonly faction?: string | null }, canManage: boolean, userId: string): Interaction | undefined {
  switch (sub) {
    case 'create':
      return { type: 'create', canManage, map: options.map ?? '', pace: options.pace ?? undefined };
    case 'start':
      return { type: 'start', canManage, userId };
    case 'stop':
      return { type: 'stop', canManage };
    case 'board':
      return { type: 'board' };
    case 'predict':
      return { type: 'predict', faction: options.faction ?? undefined };
    default:
      return undefined;
  }
}

export const fromButton = (customId: string, canManage: boolean, userId: string): Interaction => ({ type: 'button', customId, canManage, userId });
/** A press on a leaderboard button: the shell adds what it knows of the message (FR-480, FR-481). */
export const fromBoardButton = (customId: string, userId: string, entry: BoardEntryView | undefined, now: number): Interaction => ({ type: 'board-press', customId, userId, entry, now });
export const fromSelect = (customId: string, values: readonly string[]): Interaction => ({ type: 'select', customId, values });
export const fromModal = (customId: string, text: string): Interaction => ({ type: 'modal', customId, text });
export const fromAutocomplete = (focused: string, text: string): Interaction | undefined =>
  focused === STRINGS.optMap ? { type: 'autocomplete', option: 'map', text } : focused === STRINGS.optFaction ? { type: 'autocomplete', option: 'faction', text } : undefined;

const buttonOf = (button: ButtonSpec) =>
  button.type === 'link'
    ? { type: BUTTON, style: BUTTON_STYLE.link, label: button.label, url: button.url }
    : { type: BUTTON, style: BUTTON_STYLE[button.style], label: button.label, custom_id: button.customId, ...(button.disabled === true ? { disabled: true } : {}) };

/** The components of a message: its buttons in rows of at most five. */
export const componentsOf = (buttons: readonly ButtonSpec[]) => rowsOf(buttons).map((row) => ({ type: ACTION_ROW, components: row.map(buttonOf) }));

/** How a message is sent: as an embed (the bot may embed) or as the plain text of 012 (FR-475). */
export interface View {
  readonly mode: 'embed' | 'text';
}

const TEXT_VIEW: View = { mode: 'text' };

/** An embed as the API takes it, cut to Discord's limits (NFR-94); no image of any kind (FR-472). */
export function embedPayload(spec: EmbedSpec) {
  const e = fitEmbed(spec);
  return {
    title: e.title,
    color: e.color,
    ...(e.description === undefined ? {} : { description: e.description }),
    ...(e.fields.length === 0 ? {} : { fields: e.fields.map((f) => ({ name: f.name, value: f.value })) }),
    ...(e.footer === undefined ? {} : { footer: { text: e.footer } }),
  };
}

/**
 * A channel message as the library sends it. No mention pings anyone: the names show, nobody is notified. With an embed and `view.mode`
 * embed it goes as the embed (the content is cleared, so an edit of a text message to an embed one leaves no old text); otherwise as the
 * plain text, with no embed (an edit back to text clears it).
 */
export function messagePayload(message: OutMessage, view: View = TEXT_VIEW) {
  const components = componentsOf(message.buttons);
  const extra = components.length === 0 ? {} : { components };
  if (message.embed !== undefined && view.mode === 'embed') return { content: '', embeds: [embedPayload(message.embed)], allowedMentions: { parse: [] as string[] }, ...extra };
  return { content: message.text, ...(message.embed === undefined ? {} : { embeds: [] as never[] }), allowedMentions: { parse: [] as string[] }, ...extra };
}

/** The components of a message as the API sent them, every button disabled (FR-481); anything else is left as it is. */
export function withButtonsDisabled(rows: readonly { readonly type?: number; readonly components?: readonly Record<string, unknown>[] }[]) {
  return rows.map((row) => ({ ...row, components: (row.components ?? []).map((c) => (c.type === BUTTON ? { ...c, disabled: true } : c)) }));
}

/** A reply as message data (never a modal or a suggestion list); `private` marks it for the member only. */
export function replyPayload(reply: Reply, isPrivate: boolean, view: View = TEXT_VIEW) {
  const flags = isPrivate ? { flags: EPHEMERAL } : {};
  switch (reply.type) {
    case 'text':
      return [{ content: reply.text, allowedMentions: { parse: [] as string[] }, ...flags }];
    case 'channel':
      // Every part of the reply is at most 2,000 characters; the first goes as the reply, the others as follow-ups. An embed is one part.
      return reply.messages.flatMap((message) =>
        message.embed !== undefined && view.mode === 'embed'
          ? [{ ...messagePayload(message, view), ...flags }]
          : splitMessage(message.text).map((part, i) => ({ ...messagePayload({ text: part, buttons: i === 0 ? message.buttons : [] }), ...flags })),
      );
    case 'select':
      return [
        {
          content: reply.text,
          allowedMentions: { parse: [] as string[] },
          components: [{ type: ACTION_ROW, components: [{ type: STRING_SELECT, custom_id: reply.customId, placeholder: reply.placeholder, min_values: 1, max_values: 1, options: reply.options.map((o) => ({ label: o.label, value: o.value })) }] }],
          ...flags,
        },
      ];
    default:
      return [{ content: STRINGS.errUnexpected, ...flags }];
  }
}

/** The text window of a reply of type modal. */
export const modalPayload = (reply: Extract<Reply, { type: 'modal' }>) => ({
  custom_id: reply.customId,
  title: reply.title,
  components: [{ type: ACTION_ROW, components: [{ type: TEXT_INPUT, custom_id: 'q', label: reply.label, style: SHORT, required: true, min_length: 1, max_length: 50 }] }],
});

/** The id of the one text field of the window. */
export const MODAL_FIELD = 'q';

/** The slash command of the bot, as the registration sends it. */
export function commandDefinitions() {
  const text = 3;
  const sub = 1;
  return [
    {
      name: STRINGS.cmdRoot,
      description: STRINGS.cmdRootText,
      dm_permission: false,
      options: [
        {
          type: sub,
          name: STRINGS.cmdCreate,
          description: STRINGS.cmdCreateText,
          options: [
            { type: text, name: STRINGS.optMap, description: STRINGS.optMapText, required: true, autocomplete: true },
            {
              type: text,
              name: STRINGS.optPace,
              description: STRINGS.optPaceText,
              required: false,
              choices: [
                { name: STRINGS.paceFast, value: 'fast' },
                { name: STRINGS.paceNormal, value: 'normal' },
                { name: STRINGS.paceSlow, value: 'slow' },
              ],
            },
          ],
        },
        { type: sub, name: STRINGS.cmdStart, description: STRINGS.cmdStartText },
        { type: sub, name: STRINGS.cmdStop, description: STRINGS.cmdStopText },
        { type: sub, name: STRINGS.cmdBoard, description: STRINGS.cmdBoardText },
        {
          type: sub,
          name: STRINGS.cmdPredict,
          description: STRINGS.cmdPredictText,
          options: [{ type: text, name: STRINGS.optFaction, description: STRINGS.optFactionText, required: false, autocomplete: true }],
        },
      ],
    },
  ];
}
