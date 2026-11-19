// From a press, a window or a command to the action to run (spec 012 FR-451, FR-452, FR-454, FR-457, FR-458, NFR-90). Pure: the
// Discord shell turns a Discord interaction into an `Interaction` and runs the `Action` this gives. Who may manage the channel
// arrives as a plain flag (the shell reads the permission); the user id decides only who may start (FR-464), else it goes to the server.
import type { HistoryPage } from '@mbrg/protocol';
import { parseCustomId } from './custom-ids';
import type { Pace, PhaseKind } from './model';
import { isPace } from './paces';
import { STRINGS } from './strings';

/** What the shell knows of a leaderboard message a press came from: its match, who asked (none: the final post) and when it stops paging. */
export interface BoardEntryView {
  readonly matchId: string;
  readonly askerId?: string;
  readonly expiresAt: number;
}

/** What the shell knows of a history message a press came from (spec 024 FR-555): its asker, key, the pages shown so far and when it stops paging. */
export interface HistoryWalkView {
  readonly askerId: string;
  readonly community: string;
  readonly expiresAt: number;
  readonly pages: readonly HistoryPage[];
}

export type Interaction =
  | { readonly type: 'create'; readonly canManage: boolean; readonly map: string; readonly pace: string | undefined; /** The community key of the server (spec 024 FR-548); none: the interaction came without a server (FR-557). */ readonly community: string | undefined }
  | { readonly type: 'start'; readonly canManage: boolean; readonly userId: string }
  | { readonly type: 'stop'; readonly canManage: boolean }
  | { readonly type: 'board' }
  | { readonly type: 'predict'; readonly faction: string | undefined }
  | { readonly type: 'button'; readonly customId: string; readonly canManage: boolean; readonly userId: string }
  | { readonly type: 'select'; readonly customId: string; readonly values: readonly string[] }
  | { readonly type: 'modal'; readonly customId: string; readonly text: string }
  | { readonly type: 'autocomplete'; readonly option: 'map' | 'faction'; readonly text: string }
  | { readonly type: 'board-press'; readonly customId: string; readonly userId: string; readonly entry: BoardEntryView | undefined; readonly now: number }
  | { readonly type: 'history-press'; readonly customId: string; readonly userId: string; readonly entry: HistoryWalkView | undefined; readonly now: number };

export type Action =
  | { readonly do: 'say'; readonly text: string }
  | { readonly do: 'create'; readonly mapId: string; readonly pace: Pace; readonly community: string }
  | { readonly do: 'start' | 'stop' | 'board' | 'predict-open' }
  | { readonly do: 'predict-text'; readonly text: string }
  | { readonly do: 'choose'; readonly kind: PhaseKind; readonly round: number; readonly faction: number }
  | { readonly do: 'find'; readonly kind: PhaseKind; readonly round: number; readonly text: string }
  | { readonly do: 'suggest'; readonly option: 'map' | 'faction'; readonly text: string }
  /** A leaderboard page: in place on the asker's public message, as a new private reply (final post), or in place on a private page (FR-480). */
  | { readonly do: 'board-page'; readonly matchId: string; readonly page: number; readonly mode: 'asker' | 'new-private' | 'update-private' }
  /** The first page of the history of the asker's community, as a public reply (spec 024 FR-554); the paging follows with `history-page`. */
  | { readonly do: 'history'; readonly community: string }
  /** A page of a history message, in place: from the pages already shown (no `cursor`), or the next page of the walk by its cursor (spec 024 FR-555). */
  | { readonly do: 'history-page'; readonly community: string; readonly page: number; readonly pages: readonly HistoryPage[]; readonly cursor?: string };

/** How the answer is sent: deferred at once (the work may take longer than Discord's three seconds) as public or private, direct, or as the edit of the message pressed (`update`). */
export type Delivery = 'public' | 'private' | 'direct' | 'update';

const say = (text: string): Action => ({ do: 'say', text });

/** What the channel keeps: the creator of the followed match (none in an older file) and whether it has a last match (FR-464, FR-466). */
export interface ChannelInfo {
  readonly creatorId?: string;
  readonly hasLast?: boolean;
}

/** Only the creator starts a match (FR-464); an entry from an older file has no creator and falls back to the manager rule. */
const mayStart = (userId: string, canManage: boolean, info: ChannelInfo): boolean => (info.creatorId === undefined ? canManage : info.creatorId === userId);

/** The decision of one interaction; `following` says whether the channel follows a match now. */
export function decide(interaction: Interaction, following: boolean, info: ChannelInfo = {}): Action {
  switch (interaction.type) {
    case 'create': {
      // A command without a server is refused before anything else and sends nothing (spec 024 FR-557).
      if (interaction.community === undefined) return say(STRINGS.noServer);
      if (!interaction.canManage) return say(STRINGS.noPermission);
      if (following) return say(STRINGS.alreadyFollowing);
      const pace = interaction.pace ?? 'normal';
      if (!isPace(pace)) return say(STRINGS.unknownPace);
      return { do: 'create', mapId: interaction.map, pace, community: interaction.community };
    }
    case 'start':
      if (!following) return say(STRINGS.notFollowing);
      return mayStart(interaction.userId, interaction.canManage, info) ? { do: 'start' } : say(STRINGS.onlyCreator);
    case 'stop':
      if (!interaction.canManage) return say(STRINGS.noPermission);
      return following ? { do: 'stop' } : say(STRINGS.notFollowing);
    case 'board':
      return following || info.hasLast === true ? { do: 'board' } : say(STRINGS.notFollowing);
    case 'predict':
      if (!following) return say(STRINGS.notFollowing);
      return interaction.faction === undefined || interaction.faction.trim() === '' ? { do: 'predict-open' } : { do: 'predict-text', text: interaction.faction };
    case 'button': {
      const id = parseCustomId(interaction.customId);
      if (id?.type === 'start') {
        if (!following) return say(STRINGS.notFollowing);
        return mayStart(interaction.userId, interaction.canManage, info) ? { do: 'start' } : say(STRINGS.onlyCreator);
      }
      if (id?.type === 'predict') return following ? { do: 'predict-open' } : say(STRINGS.notFollowing);
      return say(STRINGS.errUnexpected);
    }
    case 'select': {
      const id = parseCustomId(interaction.customId);
      const value = interaction.values[0];
      if (id?.type !== 'pick' || value === undefined || !/^[0-9]{1,16}$/.test(value)) return say(STRINGS.errUnexpected);
      return following ? { do: 'choose', kind: id.kind, round: id.round, faction: Number(value) } : say(STRINGS.notFollowing);
    }
    case 'modal': {
      const id = parseCustomId(interaction.customId);
      if (id?.type !== 'find') return say(STRINGS.errUnexpected);
      return following ? { do: 'find', kind: id.kind, round: id.round, text: interaction.text } : say(STRINGS.notFollowing);
    }
    case 'autocomplete':
      return { do: 'suggest', option: interaction.option, text: interaction.text };
    case 'board-press': {
      const id = parseCustomId(interaction.customId);
      if (id?.type === 'mine') return { do: 'board-page', matchId: id.matchId, page: id.page, mode: 'update-private' };
      if (id?.type !== 'board') return say(STRINGS.errUnexpected);
      const entry = interaction.entry;
      // The message is unknown (the bot restarted) or past its five minutes: nothing is served (FR-481).
      if (entry === undefined || interaction.now >= entry.expiresAt) return say(STRINGS.boardExpired);
      if (entry.askerId === undefined) return { do: 'board-page', matchId: entry.matchId, page: id.page, mode: 'new-private' };
      return entry.askerId === interaction.userId ? { do: 'board-page', matchId: entry.matchId, page: id.page, mode: 'asker' } : say(STRINGS.boardNotYours);
    }
    case 'history-press': {
      const id = parseCustomId(interaction.customId);
      if (id?.type !== 'history') return say(STRINGS.errUnexpected);
      const walk = interaction.entry;
      // The message is unknown (the bot restarted) or past its five minutes: nothing is served, whoever presses (FR-555).
      if (walk === undefined || interaction.now >= walk.expiresAt) return say(STRINGS.historyExpired);
      if (walk.askerId !== interaction.userId) return say(STRINGS.historyNotYours);
      const base = { do: 'history-page' as const, community: walk.community, page: id.page, pages: walk.pages };
      // A page already shown comes back as it was (the same snapshot); the next one follows the cursor of the page shown.
      if (id.page <= walk.pages.length) return base;
      const cursor = id.page === walk.pages.length + 1 ? walk.pages[walk.pages.length - 1]?.next : undefined;
      return cursor === undefined ? say(STRINGS.errUnexpected) : { ...base, cursor };
    }
  }
}

/**
 * How each action is delivered. A press that may open a text window answers directly (a window cannot follow a deferral);
 * the work that calls the server is deferred first (NFR-91).
 */
export function deliveryOf(action: Action): Delivery {
  switch (action.do) {
    case 'create':
    case 'stop':
    case 'board':
    case 'history':
      return 'public';
    case 'history-page':
      return 'update';
    case 'board-page':
      return action.mode === 'new-private' ? 'private' : 'update';
    case 'start':
    case 'predict-text':
    case 'choose':
    case 'find':
      return 'private';
    case 'say':
    case 'predict-open':
    case 'suggest':
      return 'direct';
  }
}
