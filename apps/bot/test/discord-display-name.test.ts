import { describe, expect, it } from 'vitest';
import { displayNameOf } from '../src/discord/translate';

// Spec 022 FR-537: the display name of a member in the server is what Discord shows in the channel: the nickname there, else the
// global display name, else the username. Pure over a plain object, so it is tested without Discord.

describe('FR-537 the display name a member has in the server', () => {
  it('prefers the server nickname, then the global display name, then the username', () => {
    expect(displayNameOf({ nick: 'Capi', globalName: 'Ana L', username: 'ana99' })).toBe('Capi');
    expect(displayNameOf({ nick: null, globalName: 'Ana L', username: 'ana99' })).toBe('Ana L');
    expect(displayNameOf({ globalName: 'Ana L', username: 'ana99' })).toBe('Ana L');
    expect(displayNameOf({ nick: null, globalName: null, username: 'ana99' })).toBe('ana99');
    expect(displayNameOf({ nick: '', globalName: '', username: 'ana99' })).toBe('ana99');
  });

  it('gives nothing when Discord gives no name at all', () => {
    expect(displayNameOf({})).toBeUndefined();
    expect(displayNameOf({ nick: null, globalName: null, username: null })).toBeUndefined();
  });
});
