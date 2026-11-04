// Tests for call-tree.ts: the call tree of folded stacks and what is read from it.
import { describe, expect, it } from 'vitest';
import { callTreeOf, functionCostsOf, heightOf, matchedValueOf, nodeAt, pathOf, type CallNode } from './call-tree';

/** `node` without its parent links, to compare. */
const shapeOf = (node: CallNode): object => ({ name: node.name, value: node.value, self: node.self, children: node.children.map(shapeOf) });

describe('callTreeOf', () => {
  it('merges the stacks into one tree, children by name, the samples on the stack and as the leaf', () => {
    const tree = callTreeOf([
      { stack: 'main;b', value: 2 },
      { stack: 'main;a', value: 3 },
      { stack: 'main;a', value: 1 },
      { stack: 'main', value: 4 },
    ]);
    expect(shapeOf(tree)).toEqual({
      name: 'all',
      value: 10,
      self: 0,
      children: [
        {
          name: 'main',
          value: 10,
          self: 4,
          children: [
            { name: 'a', value: 4, self: 4, children: [] },
            { name: 'b', value: 2, self: 2, children: [] },
          ],
        },
      ],
    });
    expect(pathOf(tree.children[0].children[1]).map((node) => node.name)).toEqual(['all', 'main', 'b']);
  });

  it('skips empty frames and stacks without samples', () => {
    const tree = callTreeOf([
      { stack: ';main;;x;', value: 1 },
      { stack: 'main;y', value: 0 },
      { stack: 'main;z', value: -5 },
    ]);
    expect(shapeOf(tree)).toEqual({
      name: 'all',
      value: 1,
      self: 0,
      children: [{ name: 'main', value: 1, self: 0, children: [{ name: 'x', value: 1, self: 1, children: [] }] }],
    });
  });
});

describe('functionCostsOf', () => {
  it('sums each function over the tree by self, its total once per sample when it recurses', () => {
    const tree = callTreeOf([
      { stack: 'main;recurse;recurse;leaf', value: 3 },
      { stack: 'main;recurse', value: 2 },
      { stack: 'main;leaf', value: 1 },
    ]);
    expect(functionCostsOf(tree)).toEqual([
      { name: 'leaf', self: 4, total: 4 },
      { name: 'recurse', self: 2, total: 5 },
      { name: 'main', self: 0, total: 6 },
    ]);
  });
});

describe('nodeAt', () => {
  it('finds the frame at the names of a path, or the deepest that still exists', () => {
    const tree = callTreeOf([{ stack: 'main;a;b', value: 1 }]);
    expect(nodeAt(tree, ['all', 'main', 'a']).name).toBe('a');
    expect(nodeAt(tree, ['all', 'main', 'gone', 'b']).name).toBe('main');
  });
});

describe('matchedValueOf', () => {
  it('counts the samples of the matching frames, a match below a match once', () => {
    const tree = callTreeOf([
      { stack: 'main;db;db', value: 3 },
      { stack: 'main;db', value: 2 },
      { stack: 'main;render', value: 5 },
    ]);
    expect(matchedValueOf(tree, (name) => name === 'db')).toBe(5);
    expect(matchedValueOf(tree, () => false)).toBe(0);
  });
});

describe('heightOf', () => {
  it('is the depth of the deepest frame below', () => {
    const tree = callTreeOf([
      { stack: 'main;a;b', value: 1 },
      { stack: 'main', value: 1 },
    ]);
    expect(heightOf(tree)).toBe(3);
    expect(heightOf(tree.children[0].children[0].children[0])).toBe(0);
  });
});
