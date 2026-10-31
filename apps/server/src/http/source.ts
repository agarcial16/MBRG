// The source of a request, used only as a rate-limiter key (spec 011 plan section 8, P12). Pure: no clock, no I/O.
// - Hops 0 (the default): the TCP peer. `X-Forwarded-For` is ignored entirely, so a forged header changes nothing.
// - Hops N (1 to 8, set by the operator because N trusted proxies each append the address they saw): the entry N places
//   from the right. Everything left of it was written by the caller or by a hop the operator does not control.
// - Anything doubtful falls back to the peer: fewer entries than hops, more than 16 entries, an empty entry, an entry
//   over 64 characters, or an entry that is not an IP literal. One bad entry anywhere makes the whole header untrusted.
// The result is never stored as given: the memo scope hashes it, and the limiter keeps it in memory for one minute.

/** The most hops an operator may declare. */
export const MAX_PROXY_HOPS = 8;
/** The most entries read from the header; a longer chain is not trusted. */
const MAX_ENTRIES = 16;
/** The longest entry read, in characters. */
const MAX_ENTRY_LENGTH = 64;

const IPV4 = /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

const isIPv4 = (text: string): boolean => IPV4.test(text) && text.split('.').every((part) => Number(part) <= 255);

/** An IPv6 literal without brackets, port or zone: up to 8 groups, one `::` at most, an IPv4 tail allowed. */
const isIPv6 = (text: string): boolean => {
  if (!text.includes(':') || /[^0-9a-f:.]/.test(text)) return false;
  const gaps = text.split('::');
  if (gaps.length > 2) return false;
  const groupsOf = (part: string): string[] | undefined => {
    if (part.length === 0) return [];
    const groups = part.split(':');
    return groups.some((g) => g.length === 0) ? undefined : groups;
  };
  const head = groupsOf(gaps[0] as string);
  const tail = gaps.length === 2 ? groupsOf(gaps[1] as string) : [];
  if (head === undefined || tail === undefined) return false;
  const all = [...head, ...tail];
  let count = 0;
  for (let i = 0; i < all.length; i += 1) {
    const group = all[i] as string;
    if (group.includes('.')) {
      // An IPv4 tail counts as two groups and can only be the very last group of the address.
      if (i !== all.length - 1 || !isIPv4(group) || (gaps.length === 2 && tail.length === 0)) return false;
      count += 2;
    } else if (HEX_GROUP.test(group)) {
      count += 1;
    } else {
      return false;
    }
  }
  return gaps.length === 2 ? count <= 7 : count === 8;
};

/** The entry as a key (an IPv6 literal in lower case), or undefined when it is not an IP literal. */
const literalOf = (entry: string): string | undefined => {
  if (entry.length === 0 || entry.length > MAX_ENTRY_LENGTH) return undefined;
  const lower = entry.toLowerCase();
  return isIPv4(entry) || isIPv6(lower) ? lower : undefined;
};

/** Trims only spaces and tabs: no other character is part of the optional whitespace around a list element. */
const trimmed = (entry: string): string => entry.replace(/^[ \t]+|[ \t]+$/g, '');

/**
 * The limiter key source of a request: `peer` is the TCP peer address, `forwardedValues` the values of the
 * `X-Forwarded-For` header lines in arrival order, `hops` the number of trusted proxies (0 to 8).
 */
export function sourceOf(peer: string, forwardedValues: readonly string[], hops: number): string {
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_PROXY_HOPS) throw new RangeError('hops is a whole number 0 to 8');
  if (hops === 0) return peer;
  const entries = forwardedValues.join(',').split(',').map(trimmed);
  if (entries.length > MAX_ENTRIES || entries.length < hops) return peer;
  const literals = entries.map(literalOf);
  if (literals.some((literal) => literal === undefined)) return peer;
  return literals[entries.length - hops] as string;
}
