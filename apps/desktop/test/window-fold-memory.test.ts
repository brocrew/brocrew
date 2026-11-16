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
