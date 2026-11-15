// From a press, a window or a command to the action to run (spec 012 FR-451, FR-452, FR-454, FR-457, FR-458, NFR-90). Pure: the
// Discord shell turns a Discord interaction into an `Interaction` and runs the `Action` this gives. Who may manage the channel
// arrives as a plain flag (the shell reads the permission); the user id decides only who may start (FR-464), else it goes to the server.
import { parseCustomId } from './custom-ids';
import type { Pace, PhaseKind } from './model';
import { isPace } from './paces';
import { STRINGS } from './strings';

export type Interaction =
  | { readonly type: 'create'; readonly canManage: boolean; readonly map: string; readonly pace: string | undefined }
  | { readonly type: 'start'; readonly canManage: boolean; readonly userId: string }
  | { readonly type: 'stop'; readonly canManage: boolean }
  | { readonly type: 'board' }
  | { readonly type: 'predict'; readonly faction: string | undefined }
  | { readonly type: 'button'; readonly customId: string; readonly canManage: boolean; readonly userId: string }
  | { readonly type: 'select'; readonly customId: string; readonly values: readonly string[] }
  | { readonly type: 'modal'; readonly customId: string; readonly text: string }
  | { readonly type: 'autocomplete'; readonly option: 'map' | 'faction'; readonly text: string };

export type Action =
  | { readonly do: 'say'; readonly text: string }
  | { readonly do: 'create'; readonly mapId: string; readonly pace: Pace }
  | { readonly do: 'start' | 'stop' | 'board' | 'predict-open' }
  | { readonly do: 'predict-text'; readonly text: string }
  | { readonly do: 'choose'; readonly kind: PhaseKind; readonly round: number; readonly faction: number }
  | { readonly do: 'find'; readonly kind: PhaseKind; readonly round: number; readonly text: string }
  | { readonly do: 'suggest'; readonly option: 'map' | 'faction'; readonly text: string };

/** How the answer is sent: deferred at once (the work may take longer than Discord's three seconds) as public or private, or direct. */
export type Delivery = 'public' | 'private' | 'direct';

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
      if (!interaction.canManage) return say(STRINGS.noPermission);
      if (following) return say(STRINGS.alreadyFollowing);
      const pace = interaction.pace ?? 'normal';
      if (!isPace(pace)) return say(STRINGS.unknownPace);
      return { do: 'create', mapId: interaction.map, pace };
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
      return 'public';
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
