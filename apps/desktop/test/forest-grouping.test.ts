import { describe, expect, it } from 'vitest'
import { forestGraph, forestNodes, waitsOnIt } from '../src/renderer/src/lib/forest-graph'
import { conv, task, viewOf } from './lib/forest-fixture'

const repeated = () => viewOf([
  conv('aster', null),
  conv('teo-old', 'aster', { identity: 'teo', updatedAt: 10 }),
  conv('helper', 'teo-old'),
  conv('teo-new', 'aster', { identity: 'teo', updatedAt: 20 }),
  task('teo-new', 'piece', 'W1.2', 'Review layout', 'aster'),
  conv('other-parent', null),
  conv('teo-elsewhere', 'other-parent', { identity: 'teo' }),
])

describe('same-agent conversations share a card under their recorded parent', () => {
  it('uses the newest member for status, retains every member and keeps a different parent separate', () => {
    const cards = forestNodes(repeated(), true)
    const group = cards.find((node) => node.members)!
    expect(group.members!.map((node) => node.row.conversation)).toEqual(['teo-new', 'teo-old'])
    expect(group.row.conversationRow?.updatedAt).toBe(20)
    expect(group.parent).toBe('aster')
    expect(cards.find((node) => node.row.conversation === 'helper')!.parent).toBe(group.row.conversation)
    expect(cards.find((node) => node.row.conversation === 'teo-elsewhere')!.members).toBeUndefined()
    expect(waitsOnIt(group)).toBe(true)
    const placed = forestGraph(repeated(), true)
    expect(placed.generations.flat().map((node) => node.row.conversation).sort()).toEqual(cards.map((node) => node.row.conversation).sort())
    expect(placed.edges).toHaveLength(3)
  })

  it('keeps context parents separate even if their identities match admitted siblings', () => {
    const view = viewOf([
      conv('aster', null),
      conv('old-teo', 'aster', { identity: 'teo' }),
      conv('child', 'old-teo'),
      conv('new-teo', 'aster', { identity: 'teo' }),
    ])
    const context = { ...view, rows: view.rows.map((row) => row.conversation === 'old-teo' ? { ...row, conversationRow: { ...row.conversationRow!, context: 'window' as const } } : row) }
    const cards = forestNodes(context, true)
    expect(cards).toHaveLength(4)
    expect(cards.every((node) => !node.members)).toBe(true)
    expect(cards.find((node) => node.row.conversation === 'child')!.parent).toBe('old-teo')
  })

  it('retains the original giver relation when the parent itself is grouped', () => {
    const cards = forestNodes(viewOf([
      conv('aster', null),
      conv('parent-one', 'aster', { identity: 'neri' }),
      conv('child', 'parent-one'),
      task('child', 'piece', 'W2.1', 'Draw chart', 'parent-one'),
      conv('parent-two', 'aster', { identity: 'neri' }),
    ]), true)
    const child = cards.find((node) => node.row.conversation === 'child')!
    expect(child.parent).toBe(cards.find((node) => node.members)!.row.conversation)
    expect(waitsOnIt(child)).toBe(true)
  })
})
