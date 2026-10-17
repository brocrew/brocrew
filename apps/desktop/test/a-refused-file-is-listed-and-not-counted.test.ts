import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUNDLE_LEAF } from '../src/main/runtime/profile-bundle'
import {
  sizesAdded,
  type PartSize,
  type WhatThisAgentWasGiven,
} from '../src/shared/what-this-agent-was-given'
import { F093World } from './lib/f093-host'

/**
 * # ⛔ F093 · a file that did not reach the model is listed, and never counted
 *
 * ⚑ The contract (§1.3): *"A refused file is listed, but not counted in the sizes."* The refusal a
 * real launch makes: somebody else's file at BroBot's own name in the profile's home
 * (`unmanaged-override`) — BroBot's rules are not published over it, so on Claude nothing of them
 * reaches the model.
 *
 * ⚑ **Paired**: the same profile shape with no such file — BroBot's file is counted there.
 */

/** ⚑ What the read says BroBot wrote that reached the model, added up from its own parts. */
const brobotReaching = (read: WhatThisAgentWasGiven): PartSize =>
  sizesAdded([
    ...read.files
      .filter((one) => one.refused === null && one.origin === 'brobot')
      .map((one) => one.size),
    ...(read.thisConversation === null ? [] : [read.thisConversation.size]),
    read.tools.instructions.size,
  ])

describe('F093 · a refused file is listed and not counted', () => {
  let world: F093World

  beforeEach(() => {
    world = new F093World()
  })

  afterEach(async () => {
    await world.dispose()
  })

  it('⛔ Claude: someone else’s file at BroBot’s name — the profile file is listed, refused, and in no size', async () => {
    const home = world.homeOf('claude', 'held')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, BUNDLE_LEAF.claude), 'A person’s own file, not BroBot’s.\n')
    const host = world.buildHost()
    const held = await world.open(host, 'claude', 'held')
    const hint = world.end.newest().handle.systemHint ?? ''

    const given = world.launchesOf(held)[0]?.given
    expect(given?.profileFile?.refused).toBe('unmanaged-override')
    // ⚑ It really did not reach the model.
    expect(hint.includes(given?.profileFile?.text ?? '∅')).toBe(false)

    const read = await host.whatThisAgentWasGiven(held)
    const profile = read.files[0]
    // ⚑ Listed, with its reason, and with a size of its own …
    expect(profile).toMatchObject({ kind: 'profile-instructions', refused: 'unmanaged-override' })
    expect(profile?.size.characters).toBeGreaterThan(1_000)
    // ⛔ … and counted nowhere.
    expect(read.size.brobot).toEqual(brobotReaching(read))
    const s = read.size
    expect(s.total).toEqual(sizesAdded([s.brobot, s.otherFiles, s.tools, s.memoryInEveryRequest]))
    expect(s.total.characters).toBeLessThan(
      (profile?.size.characters ?? 0) + s.brobot.characters + s.tools.characters,
    )
  })

  it('⚑ the pair: with no file in the way the profile file reached the model, and is counted', async () => {
    const host = world.buildHost()
    const sent = await world.open(host, 'claude', 'sent')
    const read = await host.whatThisAgentWasGiven(sent)
    const profile = read.files[0]
    expect(profile).toMatchObject({ kind: 'profile-instructions', refused: null })
    expect(read.size.brobot).toEqual(brobotReaching(read))
    expect(read.size.brobot.characters).toBeGreaterThanOrEqual(profile?.size.characters ?? Infinity)
  })
})
