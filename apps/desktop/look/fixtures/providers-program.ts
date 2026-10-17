import type {
  ProviderProgram,
  ProviderProgramStanding,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { providersBridge } from './providers'

/** Fictional program and login facts for capture-only provider scenes. */
export function programBridge(standing: ProviderProgramStanding): void {
  providersBridge()
  const docs = 'https://code.claude.com/docs/en/setup'
  const tested = { oldest: '2.1.257', newest: '2.1.290' }
  const version =
    standing === 'missing' || standing === 'unreadable'
      ? null
      : standing === 'older-than-tested'
        ? '2.1.250'
        : standing === 'newer-than-tested'
          ? '2.1.300'
          : '2.1.287'
  const from =
    standing === 'missing'
      ? null
      : standing === 'newer-than-tested'
        ? 'homebrew'
        : 'native-installer'
  const path =
    standing === 'missing'
      ? null
      : from === 'homebrew'
        ? '/opt/homebrew/bin/claude'
        : '/home/example-with-a-long-home-folder/.local/bin/claude'
  const said =
    standing === 'missing'
      ? `BroCrew found no Claude Code where its installers put it, so no Claude conversation can start. Install it from ${docs}, then try again.`
      : standing === 'unreadable'
        ? `Claude Code was found at ${path}, but it did not report its version.`
        : `Claude Code ${version}, installed with ${from === 'homebrew' ? 'Homebrew' : 'Anthropic’s installer'}, at ${path}.` +
          (standing === 'older-than-tested'
            ? ' It is older than the versions BroCrew was tested with (2.1.257 to 2.1.290), so something may not work; updating it is the fix.'
            : standing === 'newer-than-tested'
              ? ' It is newer than the versions BroCrew was tested with (2.1.257 to 2.1.290).'
              : '')
  const program: ProviderProgram = {
    standing,
    from,
    path,
    version,
    tested,
    said,
    others: [],
    updatedFrom: null,
    update:
      from === null
        ? null
        : { command: from === 'homebrew' ? 'brew upgrade claude-code' : 'claude update' },
    help: {
      url: docs,
      label:
        standing === 'missing'
          ? 'How to install Claude Code'
          : standing === 'older-than-tested'
            ? 'How to update Claude Code'
            : 'Installing and updating Claude Code',
    },
  }
  const claude: ProviderVersion =
    version === null ? { version, reason: said, program } : { version, program }
  const login = (import.meta.env as Record<string, string | undefined>)['LOOK_LOGIN']
  const why = login && login !== 'refused' ? login : null
  const reasons: Record<string, string> = {
    'no-login': 'No Claude Code login on this computer.',
    expired: 'The sign-in has expired.',
    unreadable: 'The sign-in could not be read.',
  }
  window.api = {
    ...window.api,
    runtime: {
      ...window.api.runtime,
      providerVersions: async () => ({ claude, codex: { version: '0.61.0' } }),
      checkProviderAuth: async ({ provider }: { provider: string }) =>
        provider === 'claude' && why
          ? { state: why === 'unreadable' ? 'unknown' : 'absent', reason: reasons[why], why }
          : {
              state: 'usable',
              login: provider === 'claude' && login === 'refused' ? 'api-key' : 'account',
              expiresAt: null,
            },
      apiKeyStatus: async ({ provider }: { provider: string }) => ({
        provider,
        set: login === 'refused' && provider === 'claude',
        setAt: login === 'refused' && provider === 'claude' ? Date.now() - 86400000 : null,
        inUse: login === 'refused' && provider === 'claude',
        ...(login === 'refused' && provider === 'claude'
          ? { refusedForBilling: { at: Date.now() - 60000, aLoginRunsWithoutIt: true } }
          : {}),
      }),
      providerSetup: async () => ({
        claude: {
          tool: 'Claude Code',
          install: null,
          signInCommand: 'claude auth login',
          platform: 'macOS',
          shell: 'Terminal',
        },
        codex: {
          tool: 'Codex',
          install: null,
          signInCommand: 'codex',
        },
      }),
    },
  } as never
}
