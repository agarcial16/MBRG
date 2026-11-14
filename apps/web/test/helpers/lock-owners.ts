// The lockfile entries that belong to the Discord bot alone (spec 012 adds the workspace apps/bot and the approved dependency
// discord.js). The viewer's dependency pins (NFR-36, NFR-42) count every other entry, so they leave these out: the bot's
// workspace, its link, and every package reachable only through it. Pure: the parsed lockfile in, a set of keys out.

interface LockEntry {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly link?: boolean;
  readonly resolved?: string;
}
type Packages = Readonly<Record<string, LockEntry>>;

/** The lockfile key a dependency name resolves to from a package key: its own node_modules first, then each folder above. */
function resolve(packages: Packages, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const key = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (Object.hasOwn(packages, key)) return key;
    if (base === '') return undefined;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut >= 0 ? base.slice(0, cut) : base.startsWith('node_modules/') ? '' : '';
  }
}

/** Every key reachable from the roots through dependencies of any kind (links followed). */
function reach(packages: Packages, roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.pop() as string;
    if (seen.has(key) || !Object.hasOwn(packages, key)) continue;
    seen.add(key);
    const entry = packages[key] as LockEntry;
    if (entry.link === true && entry.resolved !== undefined) queue.push(entry.resolved);
    for (const group of [entry.dependencies, entry.devDependencies, entry.optionalDependencies, entry.peerDependencies]) {
      for (const name of Object.keys(group ?? {})) {
        const found = resolve(packages, key, name);
        if (found !== undefined) queue.push(found);
      }
    }
  }
  return seen;
}

export function botOwnedEntries(parsed: Readonly<Record<string, object>>): Set<string> {
  const packages = parsed as Packages;
  const others = Object.keys(packages).filter((key) => !key.includes('node_modules') && key !== 'apps/bot');
  const keep = reach(packages, others);
  const owned = new Set<string>(['apps/bot', 'node_modules/@mbrg/bot']);
  for (const key of reach(packages, ['apps/bot'])) if (!keep.has(key)) owned.add(key);
  return owned;
}
