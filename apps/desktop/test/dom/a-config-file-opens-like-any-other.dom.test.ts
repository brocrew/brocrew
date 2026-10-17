import { afterEach, describe, expect, it } from 'vitest'
import { fileManagerWord } from '../../src/renderer/src/lib/message-paths'
import { defineComponent, h, nextTick, ref } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import type {
  ConfigFileResult,
  CreatedSession,
  ProviderConfigInfo,
  RevealResult,
  SessionPathTarget,
} from '../../src/shared/runtime-ipc'
import { drawerProps, META, mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **733 · the Info panel's config rows get Open, as any other file does — `auth.json`
 * included** (`731` F-2, R92).
 *
 * ⛔ **On `main` the rows offered Finder and nothing else**, and the row's own comment said why:
 * *"Finder and nothing else, and `auth.json` is the reason it is not Open"*. The PM: *"Offer Open as
 * for any other file, and drop the credential wording."* ⚑ So the row gets the provider rows'
 * pair: Open reads the file onto the app's own paper, Finder shows it where it lives.
 *
 * ⚠️ In the dom project because a negative here (no Open on an absent file) is only worth anything
 * beside a positive on the same mount (`brobot2-ssr-tests-pass-vacuously`).
 */

afterEach(unmountAll)

const CONFIG: ProviderConfigInfo = {
  home: '/homes/default/codex',
  homeEnv: 'CODEX_HOME',
  model: 'file-based — config.toml in this home is where servers and preferences are declared',
  authNote: null,
  files: [
    {
      name: 'auth.json',
      path: '/homes/default/codex/auth.json',
      exists: true,
      note: 'the credential this profile runs on',
    },
    {
      name: 'config.toml',
      path: '/homes/default/codex/config.toml',
      exists: false,
      note: 'servers and preferences',
    },
  ],
}

const READ: ConfigFileResult = {
  ok: true,
  path: '/homes/default/codex/auth.json',
  name: 'auth.json',
  text: '{ "note": "a dummy, in a scratch home" }',
  truncated: false,
  bytes: 40,
}

function panel(props: Record<string, unknown>): Mounted {
  const session: CreatedSession = { ...META, config: CONFIG }
  return mount(SessionDrawer as never, drawerProps({ tab: 'info', session, ...props }), {
    width: 380,
    height: 900,
  })
}

const settle = async (): Promise<void> => {
  await nextTick()
  await nextTick()
}

describe('733 · a config row opens its file on the app’s paper', () => {
  it('🔴 Open is drawn for a file that is there — `auth.json` included — beside Finder', () => {
    const { q, host } = panel({
      onReadConfigFile: async () => READ,
      onRevealPath: async (): Promise<RevealResult> => ({ ok: true, path: '/x' }),
    })

    // ⛔ On `main`: no such button.
    expect(q('info-open-config-auth.json').textContent).toContain('Open')
    expect(q('info-reveal-config-auth.json').textContent).toContain(
      fileManagerWord(navigator.platform),
    )
    // ⚠️ …and none on a file that is NOT there, which says so — the absence is about existence.
    expect(host.querySelector('[data-cy="info-open-config-config.toml"]')).toBeNull()
    expect(q('config-file-config.toml').textContent).toContain('not present')
  })

  it('🔴 pressing it names the FILE, never a path, and the text is drawn inside that row', async () => {
    const asked: string[] = []
    const { q, host } = panel({
      onReadConfigFile: async (name: string): Promise<ConfigFileResult> => {
        asked.push(name)
        return READ
      },
    })

    q('info-open-config-auth.json').click()
    await settle()

    expect(asked).toEqual(['auth.json'])
    const paper = q('info-read-config-auth.json')
    expect(paper.textContent).toContain('a dummy, in a scratch home')
    expect(paper.closest('[data-cy="config-file-auth.json"]')).not.toBeNull()
    expect(q('info-open-config-auth.json').getAttribute('aria-expanded')).toBe('true')

    // A second press closes it — the provider rows' gesture.
    q('info-open-config-auth.json').click()
    await settle()
    expect(host.querySelector('[data-cy="info-read-config-auth.json"]')).toBeNull()
  })

  it('🔴 what it cannot show, it says why, inside the pressed row', async () => {
    const { q } = panel({
      onReadConfigFile: async (): Promise<ConfigFileResult> => ({
        ok: false,
        reason: 'not-readable',
      }),
    })

    q('info-open-config-auth.json').click()
    await settle()

    expect(q('info-read-config-auth.json').textContent).toContain('it cannot be shown as text here')
  })

  it('🔴 a read belongs to the conversation it was made in', async () => {
    // ⛔ Nothing between here and `RuntimeScreen` carries a `:key`, so a switch re-renders in place
    // — and this read is keyed by NAME, which the next conversation's row shares.
    const session = ref<CreatedSession>({ ...META, config: CONFIG })
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h(SessionDrawer as never, {
              ...drawerProps({
                tab: 'info',
                session: session.value,
                onReadConfigFile: async () => READ,
              }),
            })
        },
      }),
      {},
      { width: 380, height: 900 },
    )

    view.q('info-open-config-auth.json').click()
    await settle()
    expect(view.q('info-read-config-auth.json').textContent).toContain('a dummy')

    session.value = { ...META, sessionId: 'sess_another', config: CONFIG }
    await settle()
    expect(view.host.querySelector('[data-cy="info-read-config-auth.json"]')).toBeNull()
    // …and the row it would have sat in is still drawn, so the absence is the reset.
    expect(view.q('info-open-config-auth.json').textContent).toContain('Open')
  })

  /** A drawer whose session can be swapped in place — what the app does on a switch or a re-read. */
  function swappable(onReadConfigFile: (name: string) => Promise<ConfigFileResult>): {
    view: Mounted
    show: (next: CreatedSession) => Promise<void>
  } {
    const session = ref<CreatedSession>({ ...META, config: CONFIG })
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h(SessionDrawer as never, {
              ...drawerProps({ tab: 'info', session: session.value, onReadConfigFile }),
            })
        },
      }),
      {},
      { width: 380, height: 900 },
    )
    return {
      view,
      show: async (next) => {
        session.value = next
        await settle()
      },
    }
  }

  it('🔴 …and a read still IN FLIGHT at the switch does not land in the next conversation', async () => {
    // ⛔ Review of `733`: the reset cleared the paper but not the press token, so the answer to a
    // press in conversation A arrived after the switch and drew itself under B's `auth.json`.
    let answer: (result: ConfigFileResult) => void = () => {}
    const { view, show } = swappable(
      () =>
        new Promise<ConfigFileResult>((resolve) => {
          answer = resolve
        }),
    )

    view.q('info-open-config-auth.json').click()
    await settle()
    await show({ ...META, sessionId: 'sess_another', config: CONFIG })
    answer(READ)
    await settle()

    expect(view.host.querySelector('[data-cy="info-read-config-auth.json"]')).toBeNull()
    expect(view.q('info-open-config-auth.json').getAttribute('aria-expanded')).toBe('false')
  })

  it('🔴 …and a paper whose file a RE-READ says is gone goes with it', async () => {
    // ⛔ Review of `733`: the Open button is drawn only for a file that is there, so a paper left
    // under a row now reading *not present* had nothing to close it with.
    const { view, show } = swappable(async () => READ)
    view.q('info-open-config-auth.json').click()
    await settle()
    expect(view.q('info-read-config-auth.json').textContent).toContain('a dummy')

    const gone = {
      ...CONFIG,
      files: CONFIG.files.map((file) =>
        file.name === 'auth.json' ? { ...file, exists: false } : file,
      ),
    }
    await show({ ...META, config: gone })

    expect(view.host.querySelector('[data-cy="info-read-config-auth.json"]')).toBeNull()
    expect(view.q('config-file-auth.json').textContent).toContain('not present')
  })

  it('⚑ THE CONTROL — Finder is unchanged, and still names the ROW', async () => {
    const asked: SessionPathTarget[] = []
    const { q } = panel({
      onRevealPath: async (target: SessionPathTarget): Promise<RevealResult> => {
        asked.push(target)
        return { ok: true, path: 'whatever main resolved' }
      },
    })

    q('info-reveal-config-auth.json').click()
    await nextTick()

    expect(asked).toEqual([{ of: 'config-file', name: 'auth.json' }])
    expect(q('info-reveal-config-auth.json').textContent).toContain(
      fileManagerWord(navigator.platform),
    )
  })
})
