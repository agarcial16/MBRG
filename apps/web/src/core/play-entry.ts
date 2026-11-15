// Which screen a match link opens (spec 013 FR-396 to FR-398): from where the match stands and whether this browser holds a player.
// Pure; the shell reads the match and the storage and shows the screen this names.
import type { lobbyStageOf } from './lobby-model';

export type EntryScreen = 'join' | 'lobby' | 'match' | 'closed-ended' | 'closed-expired';

/**
 * No stored player: a name to join (lobby or running match), or the plain state of a match that is over or expired. A stored
 * player resumes: the lobby while it waits, the match otherwise; an expired lobby has nothing to resume.
 */
export function entryScreen(stage: ReturnType<typeof lobbyStageOf>, hasPlayer: boolean): EntryScreen {
  switch (stage) {
    case 'lobby':
      return hasPlayer ? 'lobby' : 'join';
    case 'running':
      return hasPlayer ? 'match' : 'join';
    case 'ended':
      return hasPlayer ? 'match' : 'closed-ended';
    case 'expired':
      return 'closed-expired';
  }
}
