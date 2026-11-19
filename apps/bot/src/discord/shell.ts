// The thin Discord shell (spec 012 NFR-90, NFR-91): the only module that touches the Discord library. It reads an interaction into a
// plain core one (translate.ts), asks the pure core what to do, runs the handler and sends the reply. Answers that call the server
// are deferred first (Discord gives three seconds); every reply other than a create, a stop or the board is visible only to the
// member. Nothing here is covered by tests that connect to Discord; the translations it uses are tested without it.
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { Interaction as DiscordInteraction } from 'discord.js';
import { decide, deliveryOf } from '../core/actions';
import type { ChannelInfo, Interaction } from '../core/actions';
import { parseCustomId } from '../core/custom-ids';
import { splitMessage } from '../core/limits';
import type { OutMessage, Reply } from '../core/model';
import { sendMode } from '../core/send-mode';
import { STRINGS } from '../core/strings';
import { registerSent, updateSent } from '../io/boards';
import type { Boards } from '../io/boards';
import type { Poster } from '../io/follower';
import type { Who } from '../io/handler';
import type { Action } from '../core/actions';
import { EPHEMERAL, MODAL_FIELD, commandDefinitions, displayNameOf, fromAutocomplete, fromBoardButton, fromButton, fromCommand, fromHistoryButton, fromModal, fromRankingButton, fromSelect, messagePayload, modalPayload, replyPayload, withButtonsDisabled } from './translate';
import type { View } from './translate';

export interface ShellOptions {
  /** True when the channel follows a match now, and what the channel keeps (its creator, a last match). */
  readonly following: (channelId: string) => boolean;
  readonly info: (channelId: string) => ChannelInfo;
  readonly handle: (action: Action, who: Who) => Promise<Reply>;
  readonly log: (code: string) => void;
  /** The leaderboard messages that page (FR-480, FR-481) and the clock their five minutes are counted with. */
  readonly boards: Boards;
  readonly now: () => number;
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

  /** Embed Links is read from the channel each time it matters; the first time it is missing the operator is warned once (FR-475, no member data). */
  const warned = new Set<string>();
  async function viewFor(channelId: string): Promise<View> {
    let canEmbed = true;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel !== null && !channel.isDMBased() && client.user !== null) canEmbed = channel.permissionsFor(client.user)?.has(PermissionFlagsBits.EmbedLinks) ?? true;
    } catch {
      // unreadable: assume the permission; the send itself reports a real failure
    }
    const decision = sendMode(canEmbed, warned.has(channelId));
    if (decision.warned) warned.add(channelId);
    else warned.delete(channelId);
    if (decision.warn) options.log('embed-links-missing');
    return { mode: decision.mode };
  }

  const poster: Poster = {
    async post(channelId: string, message: OutMessage): Promise<string | undefined> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) throw new Error('not-sendable');
      let view = await viewFor(channelId);
      if (message.embed !== undefined && view.mode === 'embed') {
        try {
          return (await channel.send(raw(messagePayload(message, view)))).id;
        } catch {
          // The permission could not be read (null or uncached) and Discord refused the embed: the announcement is never dropped (FR-475).
          if (!warned.has(channelId)) options.log('embed-links-missing');
          warned.add(channelId);
          view = { mode: 'text' };
        }
      }
      const parts = splitMessage(message.text);
      let firstId: string | undefined;
      for (const [i, part] of parts.entries()) {
        const sent = await channel.send(raw(messagePayload({ text: part, buttons: i === 0 ? message.buttons : [] })));
        if (i === 0) firstId = sent.id;
      }
      return firstId;
    },
    async edit(channelId: string, messageId: string, message: OutMessage): Promise<void> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !channel.isTextBased()) throw new Error('not-editable');
      const view = await viewFor(channelId);
      if (message.embed !== undefined && view.mode === 'embed') {
        await channel.messages.edit(messageId, raw(messagePayload(message, view)));
        return;
      }
      const [first] = splitMessage(message.text);
      await channel.messages.edit(messageId, raw(messagePayload({ ...message, text: first ?? message.text }, view)));
    },
    async disable(channelId: string, messageId: string): Promise<void> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !channel.isTextBased()) throw new Error('not-editable');
      const message = await channel.messages.fetch(messageId);
      await message.edit(raw({ components: withButtonsDisabled(message.components.map((row) => raw<{ type?: number; components?: Record<string, unknown>[] }>(row.toJSON()))) }));
    },
  };

  async function interactionOf(i: DiscordInteraction): Promise<Interaction | undefined> {
    const canManage = (i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false) === true;
    if (i.isChatInputCommand()) {
      return fromCommand(i.options.getSubcommand(), { map: i.options.getString(STRINGS.optMap), pace: i.options.getString(STRINGS.optPace), faction: i.options.getString(STRINGS.optFaction), order: i.options.getString(STRINGS.optOrder) }, canManage, i.user.id, i.guildId);
    }
    if (i.isAutocomplete()) {
      const focused = i.options.getFocused(true);
      return fromAutocomplete(focused.name, String(focused.value));
    }
    if (i.isButton()) {
      const id = parseCustomId(i.customId);
      if (id?.type === 'board' || id?.type === 'mine') return fromBoardButton(i.customId, i.user.id, options.boards.lookup(i.message.id), options.now());
      if (id?.type === 'history') return fromHistoryButton(i.customId, i.user.id, options.boards.lookupHistory(i.message.id), options.now());
      if (id?.type === 'ranking') return fromRankingButton(i.customId, i.user.id, options.boards.lookupRanking(i.message.id), options.now());
      return fromButton(i.customId, canManage, i.user.id);
    }
    if (i.isStringSelectMenu()) return fromSelect(i.customId, i.values);
    if (i.isModalSubmit()) return fromModal(i.customId, i.fields.getTextInputValue(MODAL_FIELD));
    return undefined;
  }

  async function route(i: DiscordInteraction): Promise<void> {
    const channelId = i.channelId;
    const core = await interactionOf(i);
    if (core === undefined || channelId === null) return;
    const action = decide(core, options.following(channelId), options.info(channelId));
    const nick = (i.member as { nickname?: string | null; nick?: string | null } | null)?.nickname ?? (i.member as { nick?: string | null } | null)?.nick;
    const displayName = displayNameOf({ nick, globalName: i.user.globalName, username: i.user.username });
    const who: Who = { channelId, userId: i.user.id, ...(displayName === undefined ? {} : { displayName }) };
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
    if (delivery === 'update') {
      // A page of a leaderboard: the pressed message is edited in place (the asker's public one, or a private page).
      if (!i.isButton()) return;
      await i.deferUpdate();
      const reply = await options.handle(action, who);
      if (reply.type !== 'channel') {
        // The board could not be read: the page stays as it is and only the member is told.
        await i.followUp(raw({ content: reply.type === 'text' ? reply.text : STRINGS.errUnexpected, flags: EPHEMERAL }));
        return;
      }
      const [first] = replyPayload(reply, false, await viewFor(channelId));
      await i.editReply(raw(first));
      // A history or ranking page edited in place: the walk keeps its stack of pages (the expiry stays the one of the posting).
      updateSent(options.boards, i.message.id, reply.messages[0]);
      return;
    }
    const isPrivate = delivery === 'private';
    await i.deferReply(isPrivate ? { flags: EPHEMERAL } : {});
    const reply = await options.handle(action, who);
    if ((action.do === 'history' || action.do === 'ranking') && reply.type === 'text') {
      // The history and the ranking are public, but "unavailable" is for the member alone (spec 024 FR-558, spec 025 FR-571): the privacy of a reply is fixed when it is deferred,
      // so the deferred public reply is removed and the sentence follows as a private one.
      await i.deleteReply();
      const [sentence] = replyPayload(reply, true);
      await i.followUp(raw(sentence));
      return;
    }
    const [first, ...rest] = replyPayload(reply, isPrivate, await viewFor(channelId));
    const sent = await i.editReply(raw(first));
    // A public leaderboard that pages is remembered by its message id (FR-480, FR-481).
    if (!isPrivate && reply.type === 'channel') registerSent(options.boards, channelId, sent.id, reply.messages[0]);
    for (const next of rest) await i.followUp(raw(next));
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
