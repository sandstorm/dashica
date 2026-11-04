// See flameGraph in flame-graph.ts.

/** A frame of the call tree: its samples on the stack (`value`) and as the leaf (`self`). */
export interface CallNode {
  readonly name: string;
  readonly value: number;
  readonly self: number;
  readonly children: readonly CallNode[];
  /** `undefined` for the root. */
  readonly parent: CallNode | undefined;
  readonly depth: number;
}

/** A function's samples over the whole tree: as the leaf (`self`), on the stack (`total`, once per sample when it recurses). */
export interface FunctionCost {
  readonly name: string;
  readonly self: number;
  readonly total: number;
}

/** The root's name: it spans all samples. */
export const ROOT_NAME = 'all';

/**
 * The call tree of `stacks` (frames root first, separated by ";", and their samples), children sorted by name. Empty
 * frames are skipped; a stack without samples counts nothing.
 */
export function callTreeOf(stacks: Iterable<{ readonly stack: string; readonly value: number }>): CallNode {
  const root = newNode(ROOT_NAME, undefined);
  for (const { stack, value } of stacks) {
    if (!(value > 0)) continue;
    let node = root;
    node.value += value;
    for (const frame of stack.split(';')) {
      if (frame === '') continue;
      node = childOf(node, frame);
      node.value += value;
    }
    node.self += value;
  }
  sortChildren(root);
  return root;
}

/** The functions of `tree` (its root left out), by `self`, then `total`, then name. */
export function functionCostsOf(tree: CallNode): FunctionCost[] {
  const costs = new Map<string, { name: string; self: number; total: number }>();
  const onStack = new Map<string, number>();
  const visit = (node: CallNode) => {
    let cost = costs.get(node.name);
    if (!cost) costs.set(node.name, (cost = { name: node.name, self: 0, total: 0 }));
    cost.self += node.self;
    const depth = onStack.get(node.name) ?? 0;
    if (depth === 0) cost.total += node.value;
    onStack.set(node.name, depth + 1);
    node.children.forEach(visit);
    onStack.set(node.name, depth);
  };
  tree.children.forEach(visit);
  return [...costs.values()].sort((a, b) => b.self - a.self || b.total - a.total || a.name.localeCompare(b.name));
}

/** The frames from the root down to `node`, both included. */
export function pathOf(node: CallNode): CallNode[] {
  const path: CallNode[] = [];
  for (let current: CallNode | undefined = node; current; current = current.parent) path.unshift(current);
  return path;
}

/** The node of `tree` at the names of `path` (from the root), or the deepest one that exists. */
export function nodeAt(tree: CallNode, path: readonly string[]): CallNode {
  let node = tree;
  for (const name of path.slice(1)) {
    const child = node.children.find((candidate) => candidate.name === name);
    if (!child) break;
    node = child;
  }
  return node;
}

/** The samples of `node` in frames `matches` accepts, each sample once: a match below a match adds nothing. */
export function matchedValueOf(node: CallNode, matches: (name: string) => boolean): number {
  if (matches(node.name)) return node.value;
  return node.children.reduce((sum, child) => sum + matchedValueOf(child, matches), 0);
}

/** The depth of the deepest frame below `node`, relative to it (0 for a leaf). */
export function heightOf(node: CallNode): number {
  return node.children.reduce((max, child) => Math.max(max, 1 + heightOf(child)), 0);
}

interface MutableNode {
  name: string;
  value: number;
  self: number;
  children: MutableNode[];
  parent: MutableNode | undefined;
  depth: number;
  /** The children by name while the tree is built; dropped after. */
  index: Map<string, MutableNode> | undefined;
}

function newNode(name: string, parent: MutableNode | undefined): MutableNode {
  return { name, value: 0, self: 0, children: [], parent, depth: parent ? parent.depth + 1 : 0, index: new Map() };
}

function childOf(node: MutableNode, name: string): MutableNode {
  let child = node.index!.get(name);
  if (!child) {
    child = newNode(name, node);
    node.index!.set(name, child);
    node.children.push(child);
  }
  return child;
}

function sortChildren(node: MutableNode): void {
  node.index = undefined;
  node.children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  node.children.forEach(sortChildren);
}
