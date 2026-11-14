// The bot's state file (spec 012 FR-459, OQ2): one small JSON file, written atomically (a temporary file in the same folder, then a
// rename), so a crash leaves the old state or the new one, never half of either. The path comes from the environment.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyState, follow, followedOf, parseState, serializeState, unfollow } from '../core/state';
import type { BotState, Followed } from '../core/state';

export type Loaded = { readonly ok: true; readonly state: BotState } | { readonly ok: false };

/** The saved state; a missing file is an empty state, a file that is not exactly a state is refused (never silently dropped). */
export function loadState(path: string): Loaded {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, state: emptyState() } : { ok: false };
  }
  const state = parseState(text);
  return state === undefined ? { ok: false } : { ok: true, state };
}

export function saveState(path: string, state: BotState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, serializeState(state), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

/** The live state: every change is saved before it returns. */
export interface StateStore {
  get(channelId: string): Followed | undefined;
  set(channelId: string, entry: Followed): void;
  remove(channelId: string): void;
  channelIds(): string[];
}

export function createStateStore(path: string, initial: BotState): StateStore {
  let state = initial;
  return {
    get: (channelId) => followedOf(state, channelId),
    set(channelId, entry) {
      const next = follow(state, channelId, entry);
      saveState(path, next);
      state = next;
    },
    remove(channelId) {
      if (followedOf(state, channelId) === undefined) return;
      const next = unfollow(state, channelId);
      saveState(path, next);
      state = next;
    },
    channelIds: () => Object.keys(state.channels),
  };
}
