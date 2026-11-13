// The translation between Discord's shapes and the core's (spec 012 NFR-90). Pure functions over plain values: the thin shell
// reads the discord.js objects, calls these and sends what they return. Nothing here imports the Discord library; the payloads
// are the raw API shapes (numeric component and button types) that the library sends as they are.
import type { Interaction } from '../core/actions';
import { rowsOf, splitMessage } from '../core/limits';
import type { ButtonSpec, OutMessage, Reply } from '../core/model';
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
export function fromCommand(sub: string, options: { readonly map?: string | null; readonly pace?: string | null; readonly faction?: string | null }, canManage: boolean): Interaction | undefined {
  switch (sub) {
    case 'create':
      return { type: 'create', canManage, map: options.map ?? '', pace: options.pace ?? undefined };
    case 'start':
    case 'stop':
      return { type: sub, canManage };
    case 'board':
      return { type: 'board' };
    case 'predict':
      return { type: 'predict', faction: options.faction ?? undefined };
    default:
      return undefined;
  }
}

export const fromButton = (customId: string, canManage: boolean): Interaction => ({ type: 'button', customId, canManage });
export const fromSelect = (customId: string, values: readonly string[]): Interaction => ({ type: 'select', customId, values });
export const fromModal = (customId: string, text: string): Interaction => ({ type: 'modal', customId, text });
export const fromAutocomplete = (focused: string, text: string): Interaction | undefined =>
  focused === STRINGS.optMap ? { type: 'autocomplete', option: 'map', text } : focused === STRINGS.optFaction ? { type: 'autocomplete', option: 'faction', text } : undefined;

const buttonOf = (button: ButtonSpec) =>
  button.type === 'link'
    ? { type: BUTTON, style: BUTTON_STYLE.link, label: button.label, url: button.url }
    : { type: BUTTON, style: BUTTON_STYLE[button.style], label: button.label, custom_id: button.customId };

/** The components of a message: its buttons in rows of at most five. */
export const componentsOf = (buttons: readonly ButtonSpec[]) => rowsOf(buttons).map((row) => ({ type: ACTION_ROW, components: row.map(buttonOf) }));

/** A channel message as the library sends it. No mention pings anyone: the names show, nobody is notified. */
export function messagePayload(message: OutMessage) {
  const components = componentsOf(message.buttons);
  return { content: message.text, allowedMentions: { parse: [] as string[] }, ...(components.length === 0 ? {} : { components }) };
}

/** A reply as message data (never a modal or a suggestion list); `private` marks it for the member only. */
export function replyPayload(reply: Reply, isPrivate: boolean) {
  const flags = isPrivate ? { flags: EPHEMERAL } : {};
  switch (reply.type) {
    case 'text':
      return [{ content: reply.text, allowedMentions: { parse: [] as string[] }, ...flags }];
    case 'channel':
      // Every part of the reply is at most 2,000 characters; the first goes as the reply, the others as follow-ups.
      return reply.messages.flatMap((message) => splitMessage(message.text).map((part, i) => ({ ...messagePayload({ text: part, buttons: i === 0 ? message.buttons : [] }), ...flags })));
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
