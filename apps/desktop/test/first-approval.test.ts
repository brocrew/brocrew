import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createLaunchGuard, saveFirstApproval } from '../src/renderer/src/lib/first-approval'

describe('remember the first successful launch choice', () => {
  it('does not save a failed start, then saves the chosen mode once', async () => {
    let chosen = false
    const save = vi.fn(async () => {
      chosen = true
      return null
    })
    await saveFirstApproval(null, 'auto', chosen, save)
    expect(save).not.toHaveBeenCalled()
    await saveFirstApproval('fictional-first', 'auto', chosen, save)
    await saveFirstApproval('fictional-second', 'ask', chosen, save)
    expect(save).toHaveBeenCalledExactlyOnceWith('auto')
  })
  it('does not overwrite a known default or invent a choice from unread facts', async () => {
    const save = vi.fn(async () => null)
    await saveFirstApproval('fictional', 'auto', true, save)
    await saveFirstApproval('fictional', 'auto', undefined, save)
    await saveFirstApproval('fictional', undefined, false, save)
    expect(save).not.toHaveBeenCalled()
  })
})

it('returns a save refusal and releases the launch guard after an exception', async () => {
  const guard = createLaunchGuard()
  await expect(saveFirstApproval('opened', 'auto', false, async () => 'Not saved.')).resolves.toBe(
    'Not saved.',
  )
  await expect(
    guard.run(async () => {
      throw new Error('Could not launch.')
    }),
  ).rejects.toThrow('Could not launch.')
  expect(guard.busy.value).toBe(false)
  const next = vi.fn(async () => {})
  await guard.run(next)
  expect(next).toHaveBeenCalledTimes(1)
})

it('the front door releases after navigation and before awaiting its first send', () => {
  const source = readFileSync(
    new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url),
    'utf8',
  )
  const wrapper = source.slice(
    source.indexOf('async function startFromFrontDoor('),
    source.indexOf('async function start('),
  )
  expect(wrapper).toContain('frontDoorLaunch.run((release) =>')
  expect(wrapper).toContain("'front-door', { navigated: release }")
  const start = source.slice(
    source.indexOf('async function start('),
    source.indexOf('const openAsForSheet'),
  )
  const navigation = start.indexOf('showConversation(sessionId, from)')
  const release = start.indexOf('told.navigated?.()')
  const send = start.indexOf("await store.send(sessionId, firstMessage, 'now', attachments)")
  expect(navigation).toBeGreaterThan(-1)
  expect(release).toBeGreaterThan(navigation)
  expect(send).toBeGreaterThan(release)
})
