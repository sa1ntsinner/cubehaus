import { trimCount } from "./average";

interface Node {
  value: number;
  copies: number;
  count: number;
  sum: number;
  height: number;
  left: Node | null;
  right: Node | null;
}

const countOf = (node: Node | null) => node?.count ?? 0;
const sumOf = (node: Node | null) => node?.sum ?? 0;
const heightOf = (node: Node | null) => node?.height ?? 0;

function measure(node: Node): Node {
  node.count = node.copies + countOf(node.left) + countOf(node.right);
  node.sum = node.value * node.copies + sumOf(node.left) + sumOf(node.right);
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
  return node;
}

function rotate(node: Node, toward: "left" | "right"): Node {
  const away = toward === "left" ? "right" : "left";
  const top = node[away];
  if (!top) return node;
  node[away] = top[toward];
  top[toward] = measure(node);
  return measure(top);
}

function balance(node: Node): Node {
  measure(node);
  const gap = heightOf(node.left) - heightOf(node.right);
  if (gap > 1 && node.left) {
    if (heightOf(node.left.right) > heightOf(node.left.left))
      node.left = rotate(node.left, "left");
    return rotate(node, "right");
  }
  if (gap < -1 && node.right) {
    if (heightOf(node.right.left) > heightOf(node.right.right))
      node.right = rotate(node.right, "right");
    return rotate(node, "left");
  }
  return node;
}

function change(node: Node | null, value: number, delta: number): Node | null {
  if (!node) {
    if (delta < 1) throw new RangeError("Value is absent from the window");
    return measure({
      value,
      copies: delta,
      height: 1,
      count: delta,
      sum: value * delta,
      left: null,
      right: null,
    });
  }
  if (value < node.value) node.left = change(node.left, value, delta);
  else if (value > node.value) node.right = change(node.right, value, delta);
  else {
    node.copies += delta;
    if (node.copies === 0) {
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      let next = node.right;
      while (next.left) next = next.left;
      node.value = next.value;
      node.copies = next.copies;
      node.right = change(node.right, next.value, -next.copies);
    }
  }
  return balance(node);
}

function prefixSum(node: Node | null, count: number): number {
  if (!node || count <= 0) return 0;
  const leftCount = countOf(node.left);
  if (count <= leftCount) return prefixSum(node.left, count);
  return (
    sumOf(node.left) +
    node.value * Math.min(node.copies, count - leftCount) +
    prefixSum(node.right, count - leftCount - node.copies)
  );
}

/** An AVL multiset for a rolling trimmed mean with DNF values sorted last. */
export class OrderStatistics {
  #root: Node | null = null;
  #dnf = 0;

  add(value: number): void {
    if (value === Infinity) this.#dnf++;
    else this.#root = change(this.#root, value, 1);
  }

  remove(value: number): void {
    if (value === Infinity) this.#dnf--;
    else this.#root = change(this.#root, value, -1);
  }

  average(): number {
    const size = countOf(this.#root) + this.#dnf;
    const trim = trimCount(size);
    if (this.#dnf > trim) return Infinity;
    return (
      (prefixSum(this.#root, size - trim) - prefixSum(this.#root, trim)) /
      (size - 2 * trim)
    );
  }
}
