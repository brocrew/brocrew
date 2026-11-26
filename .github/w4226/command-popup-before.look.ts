import { commands, page, userEvent } from 'vitest/browser'
import { expect } from 'vitest'
import { nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { paneProps, record, unmountAll } from '../../test/dom/harness'
import { boxOf, crop, scene } from '../capture'

/**
 * 🎨 W4.1430.226.6 — THROWAWAY BEFORE scene for main 5885ad75…, for the running-command popup. NOT a
 * product file and NOT a permanent test. The driver copies it to
 * `apps/desktop/look/scenes/command-popup.look.ts` of a clean checkout of main, runs it once and
 * removes the copy.
 *
 * ⚑ It imports ONLY modules that exist on main (`RunInput.vue` and the entrypoints test do not,
 *   so the after scene lives in its own file, `command-popup-after.look.ts`). Same fixture, same
 *   long fictional command, same pointer steps as the after scene.
 * ⚑ The command reaches main through fields main supports: `kind: 'local_bash'` and
 *   `description` (a live row is labelled `command?.text || description`). The `run` object is
 *   what the after pin reads; main ignores it, and nothing here depends on it.
 *
 * What main must show: the drawer row names the command, and a click on it opens OverlayHost's
 * `section.missing` "Output not available" — NOT a SheetShell, NOT RunInput, NOT ToolEntry, and
 * NOT the command text.
 */
const env = import.meta.env as Record<string, string | undefined>
const OUT_DIR = (env['LOOK_OUT'] ?? 'x.png').replace(/[^/]+$/, '')

const INPUT = `fictional-route-check --notes ${'LongRouteName'.repeat(11)} --keep-footpath-open`
type Ev = Parameters<typeof applyEvent>[1]
const RUNNING = {
  type: 'background_work',
  source: 'fixture',
  running: [
    {
      id: 'route-task',
      kind: 'local_bash',
      description: INPUT,
      run: { kind: 'command', input: INPUT },
    },
  ],
} as unknown as Ev

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

const found: Record<string, unknown> = { pin: 'before', steps: [] as string[] }

scene('command-popup', async (stage) => {
  try {
    found['userAgent'] = navigator.userAgent
    found['devicePixelRatio'] = window.devicePixelRatio
    found['viewport'] = { w: window.innerWidth, h: window.innerHeight }
    found['fontFaces'] = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style} ${f.status}`)
    found['bodyFont'] = getComputedStyle(document.body).fontFamily

    const session = ref(record([RUNNING]))
    const m = stage.mount(ConversationPane, paneProps({ record: session.value, drawerOpen: true }))
    await tick()

    // The command IS known to main: the drawer row names it…
    const row = m.q('panel-row')
    expect(row.textContent, 'main labels the row with the command').toContain(
      'fictional-route-check',
    )
    // …and a real pointer click opens the fallback, not an input view.
    await userEvent.click(row)
    await tick()
    const hosts = [...document.querySelectorAll<HTMLElement>('[data-cy=overlay-host]')]
    expect(hosts, 'exactly one open overlay').toHaveLength(1)
    const host = hosts[0]!
    const missing = host.querySelector('section.missing')
    expect(missing, 'main draws OverlayHost section.missing').not.toBeNull()
    expect(missing!.querySelector('p')?.textContent).toBe('Output not available')
    expect(host.querySelector('[data-cy=run-input]'), 'no RunInput on main').toBeNull()
    expect(host.querySelector('[data-cy=tool-entry]'), 'no ToolEntry on main').toBeNull()
    expect(host.querySelector('[data-cy=close-overlay]'), 'not a SheetShell').toBeNull()
    expect(host.textContent, 'the popup does not show the command').not.toContain(
      'fictional-route-check',
    )
    await settle()
    await crop('before-fallback', boxOf(host))
    ;(found['steps'] as string[]).push('crop:before-fallback')

    await userEvent.click(missing!.querySelector('button')!)
    await tick()
    expect(document.querySelectorAll('[data-cy=overlay-host]')).toHaveLength(0)
    ;(found['steps'] as string[]).push('before:closed-by-pointer')
    found['result'] = 'passed'
  } catch (error) {
    // A red run keeps the picture of the moment it failed (screenshotFailures is off in this
    // config) and the reason, then fails as usual. A hard kill by the driver can stop this block
    // from running, so failure.png and facts.json are NOT guaranteed.
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
