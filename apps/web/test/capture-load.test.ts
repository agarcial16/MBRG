import { describe, expect, it } from 'vitest';
import type { PublicMatch, RecordReply, StateReply } from '@mbrg/protocol';
import { loadCapture } from '../src/ui/capture-load';
import type { LiveNet, MapFiles, NetRead } from '../src/ui/live-net';

const ID = 'AbCdEfGhIjKlMnOp';
const FILES = { 'map.json': new Uint8Array(1), 'presentation.json': new Uint8Array(1), 'ids.png': new Uint8Array(1) } as unknown as MapFiles;

/** A net that records every request and serves a match with `applied` rounds. */
function fakeNet(applied: number): { net: LiveNet; calls: string[] } {
  const calls: string[] = [];
  const match = { matchId: ID, mapId: 'dev', mapDigest: 'd', appliedRounds: applied, totalRounds: 5 } as unknown as PublicMatch;
  const net: LiveNet = {
    async readPublic() {
      calls.push('public');
      return { ok: true, value: match };
    },
    async readMapFiles() {
      calls.push('files');
      return { ok: true, value: FILES };
    },
    async readState(_id, round): Promise<NetRead<StateReply>> {
      calls.push(`state:${round}`);
      return { ok: true, value: { round, owners: [[1, 1]], stateDigest: 'x', reportedTime: 0 } };
    },
    async readRecord(_id, round): Promise<NetRead<RecordReply>> {
      calls.push(`record:${round}`);
      return { ok: true, value: { round, eliminated: 2, absorber: 1, transferred: [3] } };
    },
    async openStream() {
      calls.push('stream');
      return { type: 'aborted' };
    },
  };
  return { net, calls };
}

describe('spec 038 capture data (FR-713, FR-715, NFR-187)', () => {
  it('FR-713 round k reads the state and the record of round k', async () => {
    const { net, calls } = fakeNet(3);
    const data = await loadCapture(net, { matchId: ID, round: 2, frame: 'round' });
    expect(data.ok).toBe(true);
    expect(calls).toStrictEqual(['public', 'files', 'state:2', 'record:2']);
  });

  it('FR-713 round 0 reads the state only', async () => {
    const { net, calls } = fakeNet(0);
    const data = await loadCapture(net, { matchId: ID, round: 0, frame: 'full' });
    expect(data.ok && data.record).toBeUndefined();
    expect(calls).toStrictEqual(['public', 'files', 'state:0']);
  });

  it('NFR-187 a round after the last applied one is an error and no state, record or map file of it is requested', async () => {
    const { net, calls } = fakeNet(2);
    const data = await loadCapture(net, { matchId: ID, round: 3, frame: 'round' });
    expect(data).toStrictEqual({ ok: false });
    expect(calls).toStrictEqual(['public']);
    for (const call of calls) expect(call).not.toMatch(/^(state|record):/);
  });

  it('NFR-187 the last applied round itself is allowed', async () => {
    const { net } = fakeNet(2);
    expect((await loadCapture(net, { matchId: ID, round: 2, frame: 'full' })).ok).toBe(true);
  });

  it('FR-715 a failed read is an error', async () => {
    const { net } = fakeNet(2);
    const failing: LiveNet = { ...net, readState: async () => ({ ok: false, outcome: 'retry' }) };
    expect(await loadCapture(failing, { matchId: ID, round: 1, frame: 'round' })).toStrictEqual({ ok: false });
    const unknown: LiveNet = { ...net, readPublic: async () => ({ ok: false, outcome: 'unknown-match' }) };
    expect(await loadCapture(unknown, { matchId: ID, round: 1, frame: 'round' })).toStrictEqual({ ok: false });
  });

  it('FR-715 a reply for another round than the one asked is an error', async () => {
    const { net } = fakeNet(2);
    const wrong: LiveNet = { ...net, readState: async () => ({ ok: true, value: { round: 1, owners: [], stateDigest: 'x', reportedTime: 0 } }) };
    expect(await loadCapture(wrong, { matchId: ID, round: 2, frame: 'full' })).toStrictEqual({ ok: false });
  });
});
