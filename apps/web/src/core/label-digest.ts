// Layout digest (NFR-39; plan D11). Pure: a 64-bit FNV-1a hash over the IEEE-754 bits of numbers, so a layout
// can be compared bit for bit between Node and a browser. Hand-written, no dependency (NFR-42).

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;

/**
 * FNV-1a (64 bit) over the float64 bits of the numbers, each as 8 big-endian bytes, in iteration order.
 * Returns 16 lower-case hexadecimal digits. -0 and 0 differ, as their bits do.
 */
export function digestNumbers(values: Iterable<number>): string {
  const view = new DataView(new ArrayBuffer(8));
  let hash = OFFSET;
  for (const value of values) {
    view.setFloat64(0, value, false);
    for (let i = 0; i < 8; i++) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(view.getUint8(i))) * PRIME);
    }
  }
  return hash.toString(16).padStart(16, '0');
}
