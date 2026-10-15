import { join } from 'node:path';
import type { Result } from '@mbrg/shared';
import type { Artifact } from '../core/types';
import type { FsOps } from './fs-ops';

/** FR-123: write errors; `replaced` and `notReplaced` are in the order map, presentation, image. */
export type WriteError =
  | { kind: 'write-failed'; artifact: Artifact }
  | { kind: 'partial-write'; replaced: Artifact[]; notReplaced: Artifact[] };

/** The artifacts in the order they are written and renamed, with their file names. */
export const PACKAGE_FILES: readonly { artifact: Artifact; name: string }[] = [
  { artifact: 'map', name: 'map.json' },
  { artifact: 'presentation', name: 'presentation.json' },
  { artifact: 'image', name: 'ids.png' },
];

const TEMP_SUFFIX = '.tmp';

/**
 * FR-123: replaces the three artifacts. All three are first written as temporary files in the
 * target directory, then each is renamed over its target. A failed write removes the temporary
 * files and leaves the old artifacts alone (`write-failed`); a failed first rename does the same;
 * a failed later rename removes the temporary files not renamed (`partial-write`).
 */
export function writePackage(
  outDir: string,
  files: Record<Artifact, Uint8Array>,
  fs: FsOps,
): Result<void, WriteError> {
  const entries = PACKAGE_FILES.map(({ artifact, name }) => ({
    artifact,
    target: join(outDir, name),
    temp: join(outDir, name + TEMP_SUFFIX),
  }));
  const remove = (paths: string[]): void => {
    for (const path of paths) {
      try {
        fs.unlink(path);
      } catch {
        // a temporary file that is already gone needs no cleanup
      }
    }
  };

  try {
    fs.mkdir(outDir);
  } catch {
    return { ok: false, errors: [{ kind: 'write-failed', artifact: 'map' }] };
  }

  for (const entry of entries) {
    try {
      fs.writeFile(entry.temp, files[entry.artifact]);
    } catch {
      // the failing file may be half written: it is removed with the others
      remove(entries.map((e) => e.temp));
      return { ok: false, errors: [{ kind: 'write-failed', artifact: entry.artifact }] };
    }
  }

  for (let i = 0; i < entries.length; i++) {
    try {
      fs.rename(entries[i]!.temp, entries[i]!.target);
    } catch {
      remove(entries.slice(i).map((e) => e.temp));
      if (i === 0) return { ok: false, errors: [{ kind: 'write-failed', artifact: entries[0]!.artifact }] };
      return {
        ok: false,
        errors: [
          {
            kind: 'partial-write',
            replaced: entries.slice(0, i).map((e) => e.artifact),
            notReplaced: entries.slice(i).map((e) => e.artifact),
          },
        ],
      };
    }
  }
  return { ok: true, value: undefined };
}
