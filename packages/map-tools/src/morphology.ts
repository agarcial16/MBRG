/**
 * Closing the thin non-land strips that sit between two regions.
 *
 * The bridge in `detectAdjacency` says "these two provinces border each other".
 * That is enough for the engine, but not for the renderer: the renderer decides
 * whether to stroke an edge by looking for a *neighbour polygon that shares the
 * exact same segment*, and two provinces separated by an outline share none.
 *
 * The consequence is not subtle. An unshared edge looks like the map's coastline,
 * so it is drawn — and it is drawn by both provinces, which makes it twice as
 * thick as every other border. Worse, when one of them is annexed, the edge
 * between the two is still unshared, so it keeps being drawn as if it faced the
 * sea, and a seam inside a merged faction never disappears.
 *
 * So the gap has to close in the pixels, not just in the graph. A plain dilation
 * cannot do it: the middle pixel of a two-colour gap sees a label on each side
 * and, being careful, adopts neither. This is a multi-source BFS instead —
 * distance-ordered, so "nearest region wins" is exactly what it computes.
 *
 * Only pixels reached by **two different** regions are filled. That distinction
 * is what keeps this honest:
 *
 * - An outline between two provinces is reached from both → it closes, and the
 *   two polygons end up sharing a boundary.
 * - The coastline is reached from one region only → it stays exactly where the
 *   image put it, because a coast is not a bug to be smoothed away.
 * - A lake inside one province is also reached from one region only → it
 *   survives, at any size, which a naive "fill every gap" would have erased.
 */

/**
 * A copy of `labels` where contested gaps between regions are filled in.
 *
 * Which of the two regions claims a given gap pixel is decided by pixel order,
 * so the result is deterministic; the practical effect is that the boundary ends
 * up somewhere in the middle of the outline, which is as good a place as any.
 */
export function closeGaps(
  labels: Int32Array,
  width: number,
  height: number,
  maxGap: number,
): Int32Array {
  const total = width * height;
  if (maxGap <= 0 || total === 0) return labels;

  /** First region to reach this pixel, and whether a rival reached it too. */
  const owner = new Int32Array(total).fill(-1);
  const contested = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let p = 0; p < total; p++) {
    if (labels[p] >= 0) {
      owner[p] = labels[p];
      queue[tail++] = p;
    }
  }

  // Level by level, so `owner[p]` is always the region *nearest* to p.
  for (let level = 0; level < maxGap && head < tail; level++) {
    const levelEnd = tail;
    while (head < levelEnd) {
      const p = queue[head++];
      const mine = owner[p];
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) claim(p - 1, mine);
      if (x < width - 1) claim(p + 1, mine);
      if (y > 0) claim(p - width, mine);
      if (y < height - 1) claim(p + width, mine);
    }
  }

  function claim(n: number, mine: number): void {
    if (labels[n] >= 0) return; // land keeps the label it was given
    if (owner[n] === -1) {
      owner[n] = mine;
      queue[tail++] = n;
    } else if (owner[n] !== mine) {
      contested[n] = 1;
    }
  }

  const out = Int32Array.from(labels);
  for (let p = 0; p < total; p++) {
    if (contested[p]) out[p] = owner[p];
  }
  return out;
}