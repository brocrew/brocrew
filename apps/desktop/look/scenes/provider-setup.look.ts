import { defineComponent, h, ref, type Component } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import type {
  AuthState,
  ProviderProgram,
  ProviderProgramStanding,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { scene } from '../capture'
import { settle, windowStage } from '../fixtures/window'

/**
 * 🎨 **A provider's setup, one step state per picture**, over the whole window. The state comes
 * from `LOOK_SETUP_STATE` (default `install`): install, cannot-check, older, newer, sign-in,
 * expired, key-refused, key-unreadable, ready, codex, codex-ready. `LOOK_SETUP_ON=windows` draws it
 * as a Windows PC's, with its commands by their full path. Fictional facts.
 */
const SETUP = {
  tool: 'Claude Code',
  install: {
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://code.claude.com/docs/en/setup',
  },
  signInCommand: 'claude',
  platform: 'macOS',
  shell: 'Terminal',
}

/** The same Claude Code, found on a Windows PC: its commands are typed for PowerShell. */
const ON_WINDOWS = {
  ...SETUP,
  install: { ...SETUP.install, command: 'irm https://claude.ai/install.ps1 | iex' },
  signInCommand: "& 'C:\\Users\\someone\\.local\\bin\\claude.exe'",
  platform: 'Windows',
  shell: 'PowerShell',
}

function version(standing: ProviderProgramStanding, carried = false): ProviderVersion {
  const missing = standing === 'missing'
  const program: ProviderProgram = {
    standing,
    from: missing ? null : carried ? 'carried' : 'native-installer',
    path: missing
      ? null
      : carried
        ? '/Applications/BroBot.app/codex'
        : '/Users/someone/.local/bin/claude',
    version: missing ? null : standing === 'older-than-tested' ? '2.1.250' : '2.1.300',
    tested: carried ? null : { oldest: '2.1.257', newest: '2.1.290' },
    said: 'Fictional.',
    help: carried ? null : { label: 'How to update Claude Code', url: SETUP.install.docs },
    update: carried ? null : { command: 'claude update' },
    others: [],
    updatedFrom: null,
  }
  return program.version === null
    ? { version: null, reason: 'Not found.', program }
    : { version: program.version, program }
}

const IN: AuthState = { state: 'usable', login: 'account', plan: 'max', expiresAt: null }
const OUT: AuthState = { state: 'absent', reason: 'No login on this computer.', why: 'no-login' }

interface SetupScene {
  provider: 'claude' | 'codex'
  version: ProviderVersion
  auth: AuthState
  keyRefused?: boolean
  keyUnreadable?: string
}

const STATES: Record<string, SetupScene> = {
  install: { provider: 'claude', version: version('missing'), auth: OUT },
  'cannot-check': {
    provider: 'claude',
    version: { version: null, reason: 'BroBot could not ask for the version just now.' },
    auth: OUT,
  },
  older: { provider: 'claude', version: version('older-than-tested'), auth: OUT },
  newer: { provider: 'claude', version: version('newer-than-tested'), auth: IN },
  'sign-in': { provider: 'claude', version: version('tested'), auth: OUT },
  expired: {
    provider: 'claude',
    version: version('tested'),
    auth: { state: 'stale', reason: 'The sign-in has expired.' },
  },
  'key-refused': {
    provider: 'claude',
    version: version('tested'),
    auth: { state: 'usable', login: 'api-key', expiresAt: null },
    keyRefused: true,
  },
  'key-unreadable': {
    provider: 'claude',
    version: version('tested'),
    auth: { state: 'usable', login: 'api-key', expiresAt: null },
    keyUnreadable:
      'BroBot can’t read the API key saved for Claude on this computer. macOS may be waiting for permission to read its saved key. Save it again under “API key” on the Claude card in Providers, or remove it there to use your sign-in instead.',
  },
  ready: { provider: 'claude', version: version('tested'), auth: IN },
  codex: { provider: 'codex', version: version('tested', true), auth: OUT },
  'codex-ready': { provider: 'codex', version: version('tested', true), auth: IN },
}

scene('provider-setup', async (stage) => {
  const env = import.meta.env as Record<string, string | undefined>
  const name = env.LOOK_SETUP_STATE ?? 'install'
  const state = STATES[name] ?? STATES.install!
  const setup = env.LOOK_SETUP_ON === 'windows' ? ON_WINDOWS : SETUP
  // `newer` shows the version step, as Next shows it after the install.
  const atVersion = name === 'newer'
  const now = ref<ProviderVersion>(atVersion ? version('missing') : state.version)
  const Window = windowStage()
  const Scene = defineComponent({
    setup: () => () => [
      h(Window),
      h(
        OverlayHost,
        { label: 'Set up' },
        {
          default: () => [
            h(ProviderSetupWizard as Component, {
              provider: state.provider,
              version: now.value,
              setup: state.provider === 'codex' ? null : setup,
              auth: state.auth,
              keyRefused: state.keyRefused ?? false,
              keyUnreadable: state.keyUnreadable ?? null,
              signIn:
                state.provider === 'codex'
                  ? { state: 'available' }
                  : {
                      state: 'absent',
                      reason: 'It signs in with its command.',
                      checkedAgainst: 'look',
                    },
              reprovision: { state: 'absent', reason: 'Nothing to copy.', checkedAgainst: 'look' },
              busy: 'idle',
              notice: null,
              recheck: async () => {
                now.value = state.version
              },
              other: state.provider === 'claude' && name === 'ready' ? 'codex' : null,
            }),
          ],
        },
      ),
    ],
  })
  const m = stage.mount(Scene, {})
  await settle()
  if (atVersion) {
    // Next after the install: the version newer than tested passes quietly.
    m.q('setup-next').click()
  }
  await settle()
})
