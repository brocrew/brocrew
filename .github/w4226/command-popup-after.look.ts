import { commands, page, userEvent } from 'vitest/browser'
import { expect } from 'vitest'
import { nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RunInput from '../../src/renderer/src/components/RunInput.vue'
import ToolEntry from '../../src/renderer/src/components/ToolEntry.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { paneProps, record, unmountAll } from '../../test/dom/harness'
import { boxOf, crop, scene } from '../capture'

/**
 * 🎨 W4.1430.226.6 (supersedes 226.4's scene) — THROWAWAY proof scene for the running-command popup. NOT a product file and
 * NOT a permanent test: the driver copies it to `apps/desktop/look/scenes/command-popup.look.ts`
 * inside a temporary checkout, runs it once, and deletes that copy. Runs on two pins with the same
 * fixtures and the same pointer steps; `LOOK_PIN` picks what is asserted:
 *
 *   (The before scene is a separate file, command-popup-before.look.ts: this one imports RunInput.vue,
 *    which does not exist on main.)
 *   before = main 5885ad75…  The command row has no input route: the click lands on OverlayHost's
 *            `section.missing` "Output not available". NOT a SheetShell, NOT RunInput, NOT ToolEntry.
 *   after  = beda967f2…      Unbound / unloaded run -> RunInput inside a SheetShell. A loaded call
 *            (a `tool_call` with the same id is in the transcript) -> the existing ToolEntry, on
 *            purpose, and NO RunInput.
 *
 * ⚑ Every step is a real pointer click (`userEvent.click`), never `element.click()`.
 * ⚑ Owned output only: the driver creates the output directory exclusively (mkdir without
 *   recursive; a second run on the same name fails). This scene writes only files named below into
 *   LOOK_OUT's directory, through the existing `saveLook` command.
 */
const PIN = (import.meta.env as Record<string, string | undefined>)['LOOK_PIN']
const OUT_DIR = ((import.meta.env as Record<string, string | undefined>)['LOOK_OUT'] ?? 'x.png').replace(
  /[^/]+$/,
  '',
)

// One long fictional command. No quotes or backslashes, so the tool summary survives as written.
const INPUT = `fictional-route-check --notes ${'LongRouteName'.repeat(11)} --keep-footpath-open`
const CALL = 'loaded-call'

type Ev = Parameters<typeof applyEvent>[1]
const running = (over: Record<string, unknown> = {}, run: Record<string, unknown> = {}): Ev =>
  ({
    type: 'background_work',
    source: 'fixture',
    running: [
      {
        id: 'route-task',
        kind: 'local_bash',
        description: INPUT,
        run: { kind: 'command', input: INPUT, ...run },
        ...over,
      },
    ],
  }) as never

const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}
const settle = async (): Promise<void> => {
  await document.fonts.ready
  for (let i = 0; i < 3; i++) await new Promise((done) => requestAnimationFrame(() => done(null)))
}
const save = (name: string, text: string): Promise<void> =>
  commands.saveLook(`${OUT_DIR}${name}`, btoa(unescape(encodeURIComponent(text))))

const found: Record<string, unknown> = { pin: PIN, steps: [] as string[] }
const step = (name: string): void => {
  ;(found['steps'] as string[]).push(name)
}

function overlay(): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>('[data-cy=overlay-host]')]
  expect(all, 'exactly one open overlay').toHaveLength(1)
  return all[0]!
}
async function shot(name: string): Promise<void> {
  await settle()
  await crop(name, boxOf(overlay()))
  step(`crop:${name}`)
}
async function click(el: Element): Promise<void> {
  await userEvent.click(el)
  await tick()
}

scene('command-popup', async (stage) => {
  // The scene() helper already set the viewport and mounted the icon sprite. Fresh mounts below
  // use stage.mount, so each case starts from its own session and nothing leaks between cases.
  const open = async (events: Ev[]) => {
    const session = ref(record(events))
    const m = stage.mount(ConversationPane, paneProps({ record: session.value, drawerOpen: true }))
    await tick()
    return { session, m }
  }
  try {
    // Identity facts only the page knows. The driver adds git, tree, scene hash, playwright and
    // chromium build paths. Nothing here is guessed: values are read from the running page.
    found['userAgent'] = navigator.userAgent
    found['devicePixelRatio'] = window.devicePixelRatio
    found['viewport'] = { w: window.innerWidth, h: window.innerHeight }
    found['fontFaces'] = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style} ${f.status}`)
    found['bodyFont'] = getComputedStyle(document.body).fontFamily

    if (PIN !== 'after') {
      throw new Error(`this scene is for the after pin only, got LOOK_PIN=${String(PIN)}`)
    } else if (PIN === 'after') {
      const runScope = (RunInput as { __scopeId?: string }).__scopeId
      const toolScope = (ToolEntry as { __scopeId?: string }).__scopeId
      found['runInputScope'] = runScope ?? null
      found['toolEntryScope'] = toolScope ?? null
      const sheet = (): HTMLElement => {
        const s = overlay().querySelector<HTMLElement>('.sheet-shell')
        expect(s, 'a SheetShell is open').not.toBeNull()
        return s!
      }
      const runInputs = (): NodeListOf<Element> => sheet().querySelectorAll('[data-cy=run-input]')
      const oneRunInput = (): Element => {
        expect(runInputs()).toHaveLength(1)
        expect(sheet().querySelectorAll('[data-cy=tool-entry]')).toHaveLength(0)
        const d = runInputs()[0]!
        expect(runScope, 'RunInput is scoped').toBeTruthy()
        expect(d.hasAttribute(runScope!)).toBe(true)
        expect(d.textContent).toContain(INPUT)
        return d
      }
      const hint = (): Element | null => sheet().querySelector('[data-cy=run-no-output]')
      const state = (): string | undefined =>
        sheet().querySelector('[data-cy=run-state]')?.textContent ?? undefined

      // A1 · running, no output yet
      {
        const { session, m } = await open([running()])
        await click(m.q('panel-row'))
        oneRunInput()
        expect(hint()?.textContent).toBe('No output yet.')
        expect(state()).toBeUndefined()
        await shot('after-running-no-output')

        // A2 · level removal while the sheet stays open: input stays, hint goes
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          running: [],
        } as never)
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toBeUndefined()
        await shot('after-removed-open')

        // A3 · the original progress comes back
        applyEvent(session.value.transcript, running({}, { progress: 'Reading notes' }))
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Reading notes')
        await shot('after-progress')

        // A4 · finished, opened from Past runs
        await click(m.q('close-overlay'))
        expect(document.querySelectorAll('[data-cy=overlay-host]')).toHaveLength(0)
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          running: [],
          ended: {
            id: 'route-task',
            outcome: 'completed',
            run: { result: 'Route checked' },
          },
        } as never)
        await tick()
        await click(m.q('past-runs-open'))
        await click(m.q('panel-row'))
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Route checked')
        expect(state()).not.toContain('Reading notes')
        await shot('after-finished')
        await click(m.q('close-overlay'))
        unmountAll()
      }

      // A6 · standalone terminal edge with the sheet open (Teo, 19fb95638): `ended` arrives while the
      //      run is STILL in the live list (no `running: []` yet). The command and the result show
      //      at once, the hint is gone; a later level-only removal changes nothing visible.
      {
        const { session, m } = await open([running()])
        await click(m.q('panel-row'))
        oneRunInput()
        expect(hint()?.textContent).toBe('No output yet.')
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          ended: { id: 'route-task', outcome: 'completed', run: { result: 'Route checked' } },
        } as never)
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Route checked')
        await shot('after-terminal-edge')
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          running: [],
        } as never)
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Route checked')
        await shot('after-terminal-then-removed')
        // …and Past runs, WITHOUT sending the ending again
        await click(m.q('close-overlay'))
        await click(m.q('past-runs-open'))
        await click(m.q('panel-row'))
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Route checked')
        await shot('after-terminal-then-past')
        await click(m.q('close-overlay'))
        unmountAll()
      }

      // A7 · the other order: bare level removal FIRST, standalone terminal edge second, sheet open
      {
        const { session, m } = await open([running()])
        await click(m.q('panel-row'))
        oneRunInput()
        expect(hint()?.textContent).toBe('No output yet.')
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          running: [],
        } as never)
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toBeUndefined()
        applyEvent(session.value.transcript, {
          type: 'background_work',
          source: 'fixture',
          ended: { id: 'route-task', outcome: 'completed', run: { result: 'Route checked' } },
        } as never)
        await tick()
        oneRunInput()
        expect(hint()).toBeNull()
        expect(state()).toContain('Route checked')
        await shot('after-level-then-edge')
        await click(m.q('close-overlay'))
        unmountAll()
      }

      // A5 · loaded call: the transcript holds the tool_call, so the EXISTING ToolEntry answers
      {
        const { m } = await open([
          {
            type: 'tool_call',
            id: CALL,
            name: 'Bash',
            summary: JSON.stringify({ command: INPUT }),
            run: { kind: 'command', input: INPUT },
          } as never,
          running({ toolCallId: CALL }),
        ])
        await click(m.q('panel-row'))
        expect(sheet().querySelectorAll('[data-cy=tool-entry]')).toHaveLength(1)
        expect(sheet().querySelectorAll('[data-cy=run-input]')).toHaveLength(0)
        const entry = sheet().querySelector('[data-cy=tool-entry]')!
        expect(toolScope, 'ToolEntry is scoped').toBeTruthy()
        expect(entry.hasAttribute(toolScope!)).toBe(true)
        expect(entry.querySelector('[data-cy=tool-input]')?.textContent).toContain(INPUT)
        await shot('after-loaded-call')
        await click(m.q('close-overlay'))
      }
    }
    found['result'] = 'passed'
  } catch (error) {
    // A red run still leaves the picture of the moment it failed (screenshotFailures is off in
    // this config) and the reason, then fails the run as usual.
    found['result'] = 'failed'
    found['error'] = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    try {
      await commands.saveLook(`${OUT_DIR}failure.png`, await page.screenshot({ save: false }))
    } catch (shotError) {
      found['failureScreenshotError'] = String(shotError)
    }
    throw error
  } finally {
    await save('facts.json', JSON.stringify(found, null, 2))
    unmountAll()
  }
})
