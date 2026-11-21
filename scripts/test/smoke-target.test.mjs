import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_DEFAULT_PORT,
  FORBIDDEN_PERSON_PORT,
  assertPortNotShared,
  assertPortOwnedByTree,
} from '../lib/smoke-target.mjs'

/**
 * The UI smoke must own its target: it once attached to a shared CDP port held by a different
 * worktree's app and drove that build. These tests pin the guard against that. The
 * `listeners`/`executablePath` seams stand in for the OS lookups, so a foreign target is
 * modelled without a second app.
 */

const OURS = '/Users/dev/app'
/** A sibling path that merely shares a string prefix with ours. */
const FOREIGN = '/Users/dev/app-ui-slice/node_modules/electron/dist/Electron.app/MacOS/Electron'

const guard = (pids, paths) =>
  assertPortOwnedByTree({
    port: 4242,
    repoRoot: OURS,
    listeners: () => pids,
    executablePath: (pid) => paths[pid] ?? '',
  })

describe('smoke target ownership guard (050)', () => {
  it('accepts a listener whose executable lives in THIS tree', () => {
    const owner = guard(['100'], { 100: `${OURS}/node_modules/electron/dist/Electron` })
    expect(owner).toEqual({ pid: '100', path: `${OURS}/node_modules/electron/dist/Electron` })
  })

  it('REFUSES a foreign app — the exact 049 case, a sibling worktree sharing a path prefix', () => {
    // `/Users/dev/app-ui-slice/...` starts with `/Users/dev/app` as a STRING but is a
    // different tree; the guard compares against `<root>/` precisely so this cannot pass.
    expect(() => guard(['200'], { 200: FOREIGN })).toThrow(/OUTSIDE this tree/)
    expect(() => guard(['200'], { 200: FOREIGN })).toThrow(/Refusing to attach/)
  })

  it('REFUSES a target it cannot identify (no attach on a guess)', () => {
    expect(() => guard(['300'], {})).toThrow(/OUTSIDE this tree/)
  })

  it('REFUSES when nothing is listening, rather than hanging on a dead port', () => {
    expect(() => guard([], {})).toThrow(/nothing is listening/)
  })

  it('is READ-ONLY: rejecting a foreign target touches nothing', () => {
    // The guard's only inputs are lookups; it can neither attach nor navigate. Proving it never
    // calls anything but the two read seams is what makes "fail fast, no side effects" true.
    const calls = []
    expect(() =>
      assertPortOwnedByTree({
        port: 4242,
        repoRoot: OURS,
        listeners: (port) => {
          calls.push(`listeners(${port})`)
          return ['200']
        },
        executablePath: (pid) => {
          calls.push(`executablePath(${pid})`)
          return FOREIGN
        },
      }),
    ).toThrow(/OUTSIDE this tree/)
    expect(calls).toEqual(['listeners(4242)', 'executablePath(200)'])
  })

  it('refuses the shared well-known port outright — the one that collided across trees', () => {
    expect(() => assertPortNotShared(FORBIDDEN_DEFAULT_PORT)).toThrow(/shared default/)
    expect(() => assertPortNotShared(FORBIDDEN_DEFAULT_PORT + 1)).not.toThrow()
  })

  it("⛔ refuses the person's :9444 by name before any listener can be touched (480 §6)", () => {
    expect(() => assertPortNotShared(FORBIDDEN_PERSON_PORT)).toThrow(/the person's running BroBot/)
    expect(() => assertPortNotShared(FORBIDDEN_PERSON_PORT)).toThrow(
      /never read, reload, seed or attach/,
    )
  })
})
