// Experimental-warning filter (spec 008, D7 / NFR-53).
//
// On the pinned Node, `import('node:sqlite')` prints `ExperimentalWarning: SQLite is an experimental
// feature and might change at any time`. The spec allows hiding exactly that one warning and no other:
// a warning is dropped only when its name is `ExperimentalWarning` AND its message mentions SQLite.
// Every other warning (other experimental features, deprecations, custom ones) reaches Node untouched.
//
// Call `installWarningFilter()` BEFORE the first dynamic `import('node:sqlite')`: the warning is emitted
// while the module loads.

type EmitWarning = typeof process.emitWarning;

/** True only for the `node:sqlite` ExperimentalWarning (name and message both checked). */
export const isSqliteExperimentalWarning = (message: string, name: string | undefined): boolean =>
  name === 'ExperimentalWarning' && /sqlite/i.test(message);

const nameOf = (warning: string | Error, type: unknown): string | undefined => {
  if (typeof warning !== 'string') return warning.name;
  if (typeof type === 'string') return type;
  if (typeof type === 'object' && type !== null && typeof (type as { type?: unknown }).type === 'string') {
    return (type as { type: string }).type;
  }
  return undefined; // Node's default for a string warning is `Warning`.
};

let installed = false;

/** Wraps `process.emitWarning` once; idempotent. */
export const installWarningFilter = (): void => {
  if (installed) return;
  installed = true;
  const original: EmitWarning = process.emitWarning;
  const filtered = function (this: unknown, warning: string | Error, ...rest: unknown[]): void {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (isSqliteExperimentalWarning(message, nameOf(warning, rest[0]))) return;
    (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  };
  process.emitWarning = filtered as EmitWarning;
};
