import { assertNoNaN, type Stat, trimmedMean } from "./average";
import { OrderStatistics } from "./order-statistics";

export const rankedWindowThreshold = 128;

/**
 * rolling(values, stat)[i] equals statOf(values, stat, i).
 *
 * A small ao keeps its window sorted: each step removes the value that leaves and
 * inserts the one that enters, both found by binary search and moved with
 * copyWithin, then sums the middle. That is O(n) per step with a small
 * constant. A large ao updates an order-statistics tree in O(log n). An mo
 * keeps a sum and DNF count.
 */
export function rolling(values: Float64Array, stat: Stat): Float64Array {
  assertNoNaN(values);
  const { n } = stat;
  const out = new Float64Array(values.length).fill(NaN);
  if (n > values.length) return out;
  if (stat.kind === "mo") {
    let sum = 0;
    let dnf = 0;
    for (let i = 0; i < values.length; i++) {
      const add = values[i] as number;
      if (add === Infinity) dnf++;
      else sum += add;
      if (i >= n) {
        const remove = values[i - n] as number;
        if (remove === Infinity) dnf--;
        else sum -= remove;
      }
      if (i >= n - 1) out[i] = dnf > 0 ? Infinity : sum / n;
    }
    return out;
  }
  if (n >= rankedWindowThreshold) {
    const tree = new OrderStatistics();
    for (let i = 0; i < values.length; i++) {
      if (i >= n) tree.remove(values[i - n] as number);
      tree.add(values[i] as number);
      if (i >= n - 1) out[i] = tree.average();
    }
    return out;
  }
  const sorted = new Float64Array(n);
  let size = 0;
  for (let i = 0; i < values.length; i++) {
    if (i >= n) {
      const at = lowerBound(sorted, size, values[i - n] as number);
      sorted.copyWithin(at, at + 1, size);
      size--;
    }
    const value = values[i] as number;
    const at = lowerBound(sorted, size, value);
    sorted.copyWithin(at + 1, at, size);
    sorted[at] = value;
    size++;
    if (size === n) out[i] = trimmedMean(sorted, n);
  }
  return out;
}

// The first index in sorted[0, size) whose value is not below value.
function lowerBound(sorted: Float64Array, size: number, value: number): number {
  let low = 0;
  let high = size;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] as number) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}
