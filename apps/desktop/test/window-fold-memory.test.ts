import { expect, it } from 'vitest'
import { windowFoldCache } from '../src/main/db/window-fold-cache'

function aFold(cache: ReturnType<typeof windowFoldCache>, name: string) {
  const held = cache.get(name) ?? new Map()
  cache.set(name, held)
  return held
}

const answer = () => ({ generation: 0, newest: 1, answer: { words: 'Fictional'.repeat(128) } })

it('shares one byte budget across folds and drops the least recently kept answer', () => {
  const cache = windowFoldCache(6000)
  const pieces = aFold(cache, 'pieces')
  const questions = aFold(cache, 'questions')
  const alpha = answer()
  pieces.set('alpha', alpha)
  pieces.set('beta', answer())
  pieces.delete('alpha')
  pieces.set('alpha', alpha)
  questions.set('gamma', answer())
  expect(pieces.has('alpha')).toBe(true)
  expect(pieces.has('beta')).toBe(false)
  expect(questions.has('gamma')).toBe(true)
})

it('leaves a single oversized fold uncached without dropping smaller kept answers', () => {
  const cache = windowFoldCache(6000)
  const pieces = aFold(cache, 'pieces')
  pieces.set('small', answer())
  pieces.set('large', {
    generation: 0,
    newest: 1,
    answer: new Map([['nested', new Set(['Fictional'.repeat(1024)])]]),
  })
  expect(pieces.has('small')).toBe(true)
  expect(pieces.has('large')).toBe(false)
})

it('releases its budget on changed-owner deletion and on a complete reset', () => {
  const cache = windowFoldCache(6000)
  const pieces = aFold(cache, 'pieces')
  pieces.set('alpha', answer())
  pieces.set('beta', answer())
  pieces.delete('alpha')
  const questions = aFold(cache, 'questions')
  questions.set('gamma', answer())
  expect(pieces.has('beta')).toBe(true)
  expect(questions.has('gamma')).toBe(true)
  cache.clear()
  expect(pieces.size).toBe(0)
  expect(questions.size).toBe(0)
  const fresh = aFold(cache, 'pieces')
  fresh.set('delta', answer())
  fresh.set('epsilon', answer())
  expect(fresh.size).toBe(2)
})

it('leaves an answer with opaque captured state uncached', () => {
  const cache = windowFoldCache(6000)
  const pieces = aFold(cache, 'pieces')
  const named = new Set(Array.from({ length: 1000 }, (_, n) => `piece-${n}`))
  pieces.set('opaque', {
    generation: 0,
    newest: 1,
    answer: { matches: (piece: string) => named.has(piece) },
  })
  expect(pieces.has('opaque')).toBe(false)
})

it('rejects an oversized container before visiting or queuing all its members', () => {
  const cache = windowFoldCache(6000)
  const questions = aFold(cache, 'questions')
  const wide = new Map(Array.from({ length: 1000 }, (_, n) => [n, n]))
  let visits = 0
  wide[Symbol.iterator] = function* () {
    for (const entry of Map.prototype.entries.call(this)) {
      visits++
      yield entry
    }
  }
  questions.set('wide', { generation: 0, newest: 1, answer: wide })
  expect(questions.has('wide')).toBe(false)
  expect(visits).toBe(0)
})
