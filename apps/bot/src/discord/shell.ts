// The thin Discord shell (spec 012 NFR-90, NFR-91): the only module that touches the Discord library. It reads an interaction into a
// plain core one (translate.ts), asks the pure core what to do, runs the handler and sends the reply. Answers that call the server
// are deferred first (Discord gives three seconds); every reply other than a create, a stop or the board is visible only to the
// member. Nothing here is covered by tests that connect to Discord; the translations it uses are tested without it.
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { Interaction as DiscordInteraction } from 'discord.js';
import { decide, deliveryOf } from '../core/actions';
import type { Interaction } from '../core/actions';
import { splitMessage } from '../core/limits';
import type { OutMessage, Reply } from '../core/model';
import { STRINGS } from '../core/strings';
import type { Poster } from '../io/follower';
import type { Who } from '../io/handler';
import type { Action } from '../core/actions';
import { EPHEMERAL, MODAL_FIELD, commandDefinitions, fromAutocomplete, fromButton, fromCommand, fromModal, fromSelect, messagePayload, modalPayload, replyPayload } from './translate';

export interface ShellOptions {
  /** True when the channel follows a match now. */
  readonly following: (channelId: string) => boolean;
  readonly handle: (action: Action, who: Who) => Promise<Reply>;
  readonly log: (code: string) => void;
}

export interface Shell {
  readonly poster: Poster;
  /** Connects, registers the slash command for the application and starts answering. Resolves when the bot is ready. */
  start(token: string): Promise<void>;
  stop(): Promise<void>;
}

/** The library takes the raw API shapes the translations build; the cast stays in this file. */
const raw = <T>(value: unknown): T => value as T;

export function createShell(options: ShellOptions): Shell {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const poster: Poster = {
    async post(channelId: string, message: OutMessage): Promise<void> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) throw new Error('not-sendable');
      const parts = splitMessage(message.text);
      for (const [i, part] of parts.entries()) await channel.send(raw(messagePayload({ text: part, buttons: i === 0 ? message.buttons : [] })));
    },
  };

  async function interactionOf(i: DiscordInteraction): Promise<Interaction | undefined> {
    const canManage = (i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false) === true;
    if (i.isChatInputCommand()) {
      return fromCommand(i.options.getSubcommand(), { map: i.options.getString(STRINGS.optMap), pace: i.options.getString(STRINGS.optPace), faction: i.options.getString(STRINGS.optFaction) }, canManage);
    }
    if (i.isAutocomplete()) {
      const focused = i.options.getFocused(true);
      return fromAutocomplete(focused.name, String(focused.value));
    }
    if (i.isButton()) return fromButton(i.customId, canManage);
    if (i.isStringSelectMenu()) return fromSelect(i.customId, i.values);
    if (i.isModalSubmit()) return fromModal(i.customId, i.fields.getTextInputValue(MODAL_FIELD));
    return undefined;
  }

  async function route(i: DiscordInteraction): Promise<void> {
    const channelId = i.channelId;
    const core = await interactionOf(i);
    if (core === undefined || channelId === null) return;
    const action = decide(core, options.following(channelId));
    const who: Who = { channelId, userId: i.user.id };
    if (i.isAutocomplete()) {
      const reply = await options.handle(action, who);
      await i.respond(reply.type === 'suggest' ? [...reply.choices] : []);
      return;
    }
    if (!i.isRepliable()) return;
    const delivery = deliveryOf(action);
    if (delivery === 'direct') {
      const reply = await options.handle(action, who);
      if (reply.type === 'modal' && (i.isButton() || i.isChatInputCommand())) {
        await i.showModal(raw(modalPayload(reply)));
        return;
      }
      const [first] = replyPayload(reply, true);
      await i.reply(raw(first));
      return;
    }
    const isPrivate = delivery === 'private';
    await i.deferReply(isPrivate ? { flags: EPHEMERAL } : {});
    const reply = await options.handle(action, who);
    const [first, ...rest] = replyPayload(reply, false);
    await i.editReply(raw(first));
    for (const next of rest) await i.followUp(raw({ ...next, ...(isPrivate ? { flags: EPHEMERAL } : {}) }));
  }

  client.on(Events.InteractionCreate, (interaction) => {
    route(interaction).catch(async () => {
      options.log('interaction-failed');
      try {
        if (!interaction.isRepliable()) return;
        const text = { content: STRINGS.errUnexpected, flags: EPHEMERAL };
        if (interaction.deferred || interaction.replied) await interaction.followUp(raw(text));
        else await interaction.reply(raw(text));
      } catch {
        // the interaction expired: nothing more can be said
      }
    });
  });

  return {
    poster,
    async start(token: string): Promise<void> {
      const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
      await client.login(token);
      await ready;
      await client.application?.commands.set(raw(commandDefinitions()));
    },
    async stop(): Promise<void> {
      await client.destroy();
    },
  };
}
