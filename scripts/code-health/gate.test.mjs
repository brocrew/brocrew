import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LINE_LIMIT,
  compareKeys,
  compareSizes,
  depcruiseKeys,
  jscpdKeys,
  knipKeys,
} from './gate.mjs'

const clone = (first, second, line) => ({
  format: 'typescript',
  firstFile: { name: first, start: line },
  secondFile: { name: second, start: line + 40 },
})

test('a clone pair has one identity whatever its order or position', () => {
  const before = jscpdKeys({ duplicates: [clone('b.ts', 'a.ts', 10)] })
  const after = jscpdKeys({ duplicates: [clone('a.ts', 'b.ts', 200)] })
  assert.deepEqual(before, ['typescript|a.ts|b.ts'])
  assert.deepEqual(after, before)
})

test('a cycle gives the same keys whichever module it is reported from', () => {
  const graph = ([first, second]) => ({
    summary: {
      violations: [
        { rule: { name: 'no-circular' }, from: first, to: second },
        { rule: { name: 'shared-not-to-app-layers' }, from: 's.ts', to: 'm.ts' },
      ],
    },
    modules: [first, second].map((source, i) => ({
      source,
      dependencies: [{ resolved: i ? first : second, circular: true }],
    })),
  })
  const keys = (order) => compareKeys([], depcruiseKeys(graph(order))).added
  assert.deepEqual(keys(['a.ts', 'b.ts']), [
    'no-circular|a.ts|b.ts',
    'no-circular|b.ts|a.ts',
    'shared-not-to-app-layers|s.ts|m.ts',
  ])
  assert.deepEqual(keys(['b.ts', 'a.ts']), keys(['a.ts', 'b.ts']))
})

test('knip findings are keyed by type, file and symbol, not by line', () => {
  const report = (line) => ({
    issues: [
      {
        file: 'src/x.ts',
        exports: [{ name: 'unused', line }],
        enumMembers: [{ name: 'B', namespace: 'Letters', line }],
        files: [],
      },
    ],
  })
  assert.deepEqual(knipKeys(report(3)), [
    'exports|src/x.ts|unused',
    'enumMembers|src/x.ts|Letters.B',
  ])
  assert.deepEqual(knipKeys(report(90)), knipKeys(report(3)))
})

test('knip object-valued member categories retain their enum or class namespace', () => {
  const report = (line) => ({
    issues: [
      {
        file: 'src/x.ts',
        exports: [{ name: 'unused', line }],
        enumMembers: { Letters: [{ name: 'B', line }], Numbers: [{ name: 'Two', line }] },
        classMembers: { Example: [{ name: 'unusedMethod', line }] },
      },
    ],
  })
  assert.deepEqual(knipKeys(report(3)), [
    'exports|src/x.ts|unused',
    'enumMembers|src/x.ts|Letters.B',
    'enumMembers|src/x.ts|Numbers.Two',
    'classMembers|src/x.ts|Example.unusedMethod',
  ])
  assert.deepEqual(knipKeys(report(90)), knipKeys(report(3)))
})

test('knip rejects malformed member categories instead of dropping their findings', () => {
  const shapes = [{ Example: { name: 'unused' } }, { Example: [], Broken: null }, null, 'unused', 1]
  for (const type of ['enumMembers', 'classMembers']) {
    for (const items of shapes) {
      assert.throws(() => knipKeys({ issues: [{ file: 'src/x.ts', [type]: items }] }), {
        message: `knip: unexpected ${type} issue shape in src/x.ts`,
      })
    }
  }
})

test('only identities missing from the baseline are new; vanished ones are resolved', () => {
  const result = compareKeys(['old', 'gone'], ['old', 'old', 'fresh'])
  assert.deepEqual(result, { added: ['fresh'], resolved: ['gone'] })
})

test('a listed giant may shrink but not grow, and no other file may pass the limit', () => {
  const baseline = { 'giant.ts': 5000 }
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 4990 }).added, [])
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 5001 }).added, [
    'max-lines|giant.ts|5001 lines, allowed 5000',
  ])
  assert.deepEqual(compareSizes(baseline, { 'giant.ts': 5000, 'new.ts': LINE_LIMIT + 1 }).added, [
    `max-lines|new.ts|${LINE_LIMIT + 1} lines, allowed ${LINE_LIMIT}`,
  ])
  assert.deepEqual(compareSizes(baseline, {}).resolved, ['max-lines|giant.ts'])
})
