// The ONLY module that arms a timer (D30; 004 FR-155, 005 NFR-35). The live runner keeps one retry timer with replace
// semantics and one per-second refresh of the panel; both go through `after`, so a test can inject a fake.
export type Cancel = () => void;
export type After = (ms: number, fn: () => void) => Cancel;

/** Runs `fn` once after `ms` milliseconds; the returned function cancels it. */
export const after: After = (ms, fn) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};
