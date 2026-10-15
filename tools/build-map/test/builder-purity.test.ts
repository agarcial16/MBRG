import { describe, expect, it, vi } from 'vitest';
import { buildInMemory } from '../src/core/build';
import { pngCodec } from '../src/io/png-codec';
import { miniInputs } from './helpers/fixtures';

describe('NFR-14 the in-memory build is deterministic and touches no clock or randomness', () => {
  it('NFR-14 and NFR-23 the in-memory build with the real PNG library runs while clock and randomness throw', () => {
    const boom = (name: string) => () => {
      throw new Error(`${name} was called during the build`);
    };
    const RealDate = Date;
    class ThrowingDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) throw new Error('new Date() was called during the build');
        super(...(args as [number]));
      }
      static override now(): number {
        throw new Error('Date.now was called during the build');
      }
    }
    const spies = [
      vi.spyOn(Math, 'random').mockImplementation(boom('Math.random')),
      vi.spyOn(performance, 'now').mockImplementation(boom('performance.now')),
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(boom('crypto.getRandomValues')),
      vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(boom('crypto.randomUUID')),
      vi.spyOn(process, 'hrtime').mockImplementation(boom('process.hrtime')),
    ];
    vi.stubGlobal('Date', ThrowingDate);
    let first: ReturnType<typeof buildInMemory>;
    let second: ReturnType<typeof buildInMemory>;
    try {
      // The guards really throw while installed.
      expect(() => Math.random()).toThrow();
      expect(() => Date.now()).toThrow();
      expect(() => new Date()).toThrow();
      expect(() => performance.now()).toThrow();
      for (const spy of spies) spy.mockClear();
      first = buildInMemory(miniInputs(), pngCodec);
      second = buildInMemory(miniInputs(), pngCodec);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      for (const spy of spies) spy.mockRestore();
    }
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(Buffer.from(first.files.image).equals(Buffer.from(second.files.image))).toBe(true);
      expect(Buffer.from(first.files.map).equals(Buffer.from(second.files.map))).toBe(true);
    }
  });
});
