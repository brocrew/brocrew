import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import type { ChosenCwd } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 423 M15 · the placed door sends the folder a person chose
 *
 * **In the DOM project because the claim is about a press.** The sheet's folder is a `ref` that a
 * button's click handler fills from `window.api.chooseCwd()`; SSR renders the first frame and never
 * presses anything, so no node-project test can see what the launch carries afterwards.
 *
 * ## ⚑ What this pins
 *
 * `HO-023 §3`'s half **(b)** — *point a conversation at a repository* — is delivered by exactly one
 * field the front door does not send: `cwd`. ⛔ **`a-gesture-that-creates-an-agent.dom.test.ts` §6
 * only ever launches with NO folder**, so a sheet that dropped the field altogether (every launch
 * lands in the app's own workspace whatever the person chose) passed it. D-016 replaced the project
 * select with a folder picker, so *the person's placement* is now this one `cwd`.
 *
 * ⚠️ **The stub is `window.api.chooseCwd`, the host's own picker** — `ChosenCwd` is `{ path }` for a
 * folder that was chosen and usable, `{ path, refusal }` for one the host's rule refused, and `null`
 * for a cancel. ⛔ **Every negative below is paired with the positive from the same mount** — the
 * standing `brobot2-ssr-tests-pass-vacuously` rule: a launch with no `cwd` proves nothing unless the
 * same sheet, in the same file, has just been shown to send one.
 */

let picked: ChosenCwd

/**
 * ⚑ **Installed per test, over mutable state.** `useAgentStore` memoises `window.api.runtime` at its
 * first call and this sheet never reads the roster, so the runtime member only has to exist.
 */
beforeEach(() => {
  picked = null
  ;(window as unknown as { api?: unknown }).api = {
    chooseCwd: () => Promise.resolve(picked),
    runtime: {
      agentIdentities: () => Promise.resolve(null),
    },
  }
})
afterEach(unmountAll)

const settled = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

const placed = (): { m: Mounted; started: unknown[] } => {
  const started: unknown[] = []
  const m = mount(
    defineComponent({
      setup: () => () =>
        h(StartAsAgent as never, {
          profileSlug: 'archivist',
          provider: 'claude',
          defaultApprovalMode: 'ask',
          capabilities: null,
          onStart: (input: unknown, words: string) => started.push([input, words]),
        }),
    }),
    {},
    { width: 700, height: 700 },
  )
  return { m, started }
}

const type = async (m: Mounted, cy: string, value: string): Promise<void> => {
  const field = m.q(cy) as HTMLInputElement
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
}

const send = async (m: Mounted, words: string): Promise<void> => {
  await type(m, 'prompt-input', words)
  ;(m.q('send-prompt') as HTMLButtonElement).click()
  await settled()
}

const choose = async (m: Mounted, answer: ChosenCwd): Promise<void> => {
  picked = answer
  m.q('start-as-agent-choose-folder').click()
  await settled()
}

describe('the folder a person chose is the one the placed conversation is launched in', () => {
  it('🔴 a chosen folder is what the launch carries as `cwd`, beside the identity and the provider', async () => {
    const f = placed()
    await settled()
    await choose(f.m, { path: '/work/repo' })
    // ⚑ The sheet says it, so the press is visible before the send — and the launch agrees.
    expect(f.m.q('start-as-agent-folder').textContent).toBe('/work/repo')
    await send(f.m, 'read the failing test')
    expect(f.started).toEqual([
      [
        {
          provider: 'claude',
          profileId: 'archivist',
          cwd: '/work/repo',
          approvalMode: 'ask',
        },
        'read the failing test',
      ],
    ])
  })

  it('⛔ a folder the host refused is not the one sent — and the folder chosen before it still is', async () => {
    const f = placed()
    await settled()
    // The positive first, from this same mount: a usable folder is chosen ...
    await choose(f.m, { path: '/work/repo' })
    // ... and then a second choice is refused, with the host's own sentence.
    await choose(f.m, { path: '/work/nope', refusal: '/work/nope is not a folder' })
    expect(f.m.q('start-as-agent-folder-refused').textContent).toContain('is not a folder')
    expect(f.m.q('start-as-agent-folder').textContent).toBe('/work/repo')
    await send(f.m, 'go')
    expect(f.started).toEqual([
      [
        { provider: 'claude', profileId: 'archivist', cwd: '/work/repo', approvalMode: 'ask' },
        'go',
      ],
    ])
  })

  it('⚑ a cancelled picker changes nothing, and "Use the workspace" takes the folder back', async () => {
    const f = placed()
    await settled()
    await choose(f.m, { path: '/work/repo' })
    // A cancel is a changed mind (`ChosenCwd` is `null`): the chosen folder stays.
    await choose(f.m, null)
    expect(f.m.q('start-as-agent-folder').textContent).toBe('/work/repo')
    // And the way back to the workspace is one press, after which the launch carries no `cwd`.
    f.m.q('start-as-agent-use-workspace').click()
    await settled()
    expect(f.m.all('start-as-agent-folder')).toHaveLength(0)
    expect(f.m.q('start-as-agent-no-folder').textContent).toMatch(/workspace/i)
    await send(f.m, 'go')
    expect(f.started).toEqual([
      [{ provider: 'claude', profileId: 'archivist', approvalMode: 'ask' }, 'go'],
    ])
  })
})
