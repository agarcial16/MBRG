// What a capture reads (spec 038 FR-713, FR-715, NFR-187): the public data of the match, the map files, the state after round k and, for
// round k >= 1, its record. It asks for nothing the live viewer may not ask for: a round above the applied rounds of the match is refused
// BEFORE any request for it (the same gate as `canRequest`), so capture mode adds no way to read a later round.
import type { PublicMatch, RecordReply, StateReply } from '@mbrg/protocol';
import type { CaptureRequest } from '../core/capture';
import { canRequest } from '../core/live-rounds';
import type { LiveNet, MapFiles } from './live-net';

export type CaptureData =
  | {
      readonly ok: true;
      readonly match: PublicMatch;
      readonly files: MapFiles;
      readonly state: StateReply;
      /** The record of round k; absent for round 0. */
      readonly record: RecordReply | undefined;
    }
  | { readonly ok: false };

const FAILED: CaptureData = { ok: false };

/** Reads what the capture of `request` draws, or says it cannot (the page then exposes the "error" signal). One try each: the bot owns the retry. */
export async function loadCapture(net: LiveNet, request: CaptureRequest): Promise<CaptureData> {
  const read = await net.readPublic(request.matchId);
  if (!read.ok) return FAILED;
  const match = read.value;
  if (!canRequest(match.appliedRounds, 'state', request.round)) return FAILED;
  const files = await net.readMapFiles(match.mapId, match.mapDigest);
  if (!files.ok) return FAILED;
  const state = await net.readState(request.matchId, request.round);
  if (!state.ok || state.value.round !== request.round) return FAILED;
  if (request.round < 1) return { ok: true, match, files: files.value, state: state.value, record: undefined };
  if (!canRequest(match.appliedRounds, 'record', request.round)) return FAILED;
  const record = await net.readRecord(request.matchId, request.round);
  if (!record.ok || record.value.round !== request.round) return FAILED;
  return { ok: true, match, files: files.value, state: state.value, record: record.value };
}
