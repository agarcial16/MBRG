// The public match config (spec 014, FR-413, FR-414, FR-415, FR-421): the values of public creation that a visitor may choose
// from, read from the very settings object that creation enforces. Pure: no clock, no random source, no storage, no match.
import type { PublicConfig } from '@mbrg/protocol';
import type { Settings } from './settings';

/**
 * The public config of the settings: the public map ids in the operator's order (a fresh array), the timing bounds in seconds,
 * the player cap, and `enabled` (true exactly when the map list is not empty; never stored). Each field is read by name, so
 * nothing else of the settings (credentials, clients, origins, listener, database, folders, limits, caps, expiry) can reach it.
 */
export function publicConfigOf(settings: Settings): PublicConfig {
  const rules = settings.publicCreation;
  return {
    maps: [...rules.maps],
    minInterval: rules.minInterval,
    maxInterval: rules.maxInterval,
    minPhase1: rules.minPhase1,
    minPhase2: rules.minPhase2,
    maxPlayers: settings.maxPlayers,
    enabled: rules.maps.length > 0,
  };
}
