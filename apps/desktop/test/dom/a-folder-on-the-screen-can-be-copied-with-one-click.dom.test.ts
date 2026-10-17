import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **452 M15 · a folder that is on the screen has to be reachable by the person who reads it.**
 *
 * ⚑ **This app has no clipboard-write door of any kind** (`main` only ever calls
 * `clipboard.readImage`), so the Info tab's paths — the conversation's `cwd` and the agent's home —
 * cannot carry a Copy button. `.path { user-select: all }` in `SessionInfo.vue` is the whole
 * answer: one click takes the WHOLE folder, and it is then one keystroke from a terminal.
 *
 * ⛔ **Nothing asserted it after `D-016a` (`bd70d693`).** The room-behind-the-door test whose line
 * 254 held the only `userSelect` assertion for a path went with the project rooms, and the one
 * left in the tree (`build-identity.test.ts`) is about `.sync-detail`. A `user-select: auto` on
 * `.path` left every suite green while a person had to drag a long path by hand.
 *
 * ⚠️ **In `dom/` because the answer is COMPUTED**: an SSR render has no cascade, and a string match
 * on the source would pass a rule that another declaration overrides. The press is a REAL click
 * in Chromium and the assertion reads what the browser SELECTED, so it is the person's gesture that
 * is measured and not a property name.
 *
 * ⚑ **Every claim is paired with the control on the same mount**: the panel around the paths is
 * NOT selectable-whole, so a blanket `user-select: all` (or a stylesheet that made everything
 * selectable) could not satisfy the positive by accident.
 */

afterEach(unmountAll)

const HOME = '/homes/claude/a-long-agent-home-that-is-a-path-someone-pastes'
const CWD = '/work/checkout/with/several/nested/folders/beneath/it'

function info(): Mounted {
  const session: CreatedSession = {
    ...META,
    cwd: CWD,
    config: { ...META.config, home: HOME },
  }
  return mount(SessionDrawer as never, drawerProps({ tab: 'info', session }), {
    width: 380,
    height: 900,
  })
}

const selectable = (el: Element): string => getComputedStyle(el).userSelect

/**
 * ⚠️ **The section carries an explicit timeout, as `the-screen-whose-job-is-start-typing` does and
 * for its reason (rule 22):** each `userEvent.click` is a real CDP round trip, and in a whole-suite
 * run the path's click waited out the 15 s default and failed while it passed alone. The bound
 * reports the machine, not the rule; the selection assertions are what catch a broken rule.
 */
describe(
  'a folder drawn on the Info tab is selected whole by one click (452 M15)',
  { timeout: 60_000 },
  () => {
    it('🔴 the cwd and the home both draw their path as a select-all box, and the panel around them does not', () => {
      const { q } = info()

      // The paths are really on the screen, so what follows is a measurement of them.
      expect(q('session-cwd').textContent).toBe(CWD)
      expect(q('session-home').textContent).toBe(HOME)

      expect(selectable(q('session-cwd'))).toBe('all')
      expect(selectable(q('session-home'))).toBe('all')

      // ⚑ THE CONTROL — the panel that holds them, and the label beside the cwd, are ordinary text.
      expect(selectable(q('session-info'))).not.toBe('all')
      const label = q('session-cwd').closest('dd')?.previousElementSibling
      expect(label?.tagName, 'the cwd row lost its label').toBe('DT')
      expect(selectable(label!)).not.toBe('all')
    })

    it('🔴 one real click on the path selects the whole folder, so it can be pasted into a terminal', async () => {
      const { q } = info()
      const selection = (): string => window.getSelection()?.toString() ?? ''

      // Nothing is selected before the person touches anything — the assertion below is the click's.
      window.getSelection()?.removeAllRanges()
      expect(selection()).toBe('')

      await userEvent.click(q('session-cwd'))
      expect(selection()).toBe(CWD)

      // ⚑ …and the same for the home, which is a different row in a different group.
      await userEvent.click(q('session-home'))
      expect(selection()).toBe(HOME)
    })

    it('⚑ THE CONTROL — a click on ordinary text selects no folder', async () => {
      // A click that selected the folder no matter where it landed would pass the test above with
      // the rule deleted; the same gesture on a label must leave the paths out of the selection.
      const { q } = info()
      const label = q('session-cwd').closest('dd')?.previousElementSibling
      expect(label?.tagName, 'the cwd row lost its label').toBe('DT')

      window.getSelection()?.removeAllRanges()
      await userEvent.click(label!)
      expect(window.getSelection()?.toString() ?? '').not.toContain(CWD)
      expect(window.getSelection()?.toString() ?? '').not.toContain(HOME)
    })
  },
)
