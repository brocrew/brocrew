/**
 * 🎨 **The Providers page's data** — both providers with sample usage, what their processes use, and
 * current versions; or one signed out and the other running on a saved key. Fake data only: no
 * account, plan or figure here is anybody's.
 */
const NOW = Date.now()
const HOUR = 3_600_000

type Provider = 'claude' | 'codex'

const MODELS: Record<Provider, string[]> = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-codex'],
}

const USAGE = {
  claude: [
    { window: 'five_hour', usedPercent: 42, resetsAt: NOW + 2.5 * HOUR, at: NOW - 60_000 },
    { window: 'seven_day', usedPercent: 67, resetsAt: NOW + 3 * 24 * HOUR, at: NOW - 60_000 },
  ],
  // Codex reports its weekly window only.
  codex: [
    { window: 'a 7-day window', usedPercent: 31, resetsAt: NOW + 5 * 24 * HOUR, at: NOW - 300_000 },
  ],
}

const RESOURCES = {
  claude: { running: 3, at: NOW, rssBytes: 1_240_000_000, cpuPercent: 37 },
  codex: { running: 1, at: NOW, rssBytes: 286_000_000, cpuPercent: 4 },
}

const VERSIONS = {
  claude: {
    version: '2.1.301',
    program: {
      standing: 'tested',
      from: 'native-installer',
      path: '/Users/someone/.local/bin/claude',
      version: '2.1.301',
      tested: { oldest: '2.1.280', newest: '2.1.305' },
      said: 'Claude Code 2.1.301, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude, the first of 2 copies BroCrew finds, and the one it runs.',
      help: {
        label: 'Installing and updating Claude Code',
        url: 'https://code.claude.com/docs/en/setup',
      },
      others: [
        {
          from: 'homebrew',
          path: '/opt/homebrew/bin/claude',
          version: '2.1.245',
          said: '2.1.245, installed with Homebrew, at /opt/homebrew/bin/claude',
        },
      ],
      updatedFrom: '2.1.292',
    },
  },
  codex: {
    version: '0.61.0',
    program: {
      standing: 'tested',
      from: 'carried',
      path: '/Applications/BroBot.app/Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex',
      version: '0.61.0',
      tested: null,
      said: 'Codex 0.61.0, the copy BroCrew carries, at /Applications/BroBot.app/Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex.',
      help: null,
      others: [],
      updatedFrom: null,
    },
  },
}

const SIGNED_IN = {
  claude: {
    state: 'usable',
    account: 'someone@example.com',
    login: 'account',
    plan: 'max',
    expiresAt: NOW + 21 * 24 * HOUR,
  },
  codex: {
    state: 'usable',
    account: 'someone@example.com',
    login: 'account',
    plan: 'plus',
    expiresAt: null,
  },
}

const SIGNED_OUT_AND_KEY = {
  claude: {
    state: 'absent',
    reason: 'No Claude Code login on this Mac.',
    why: 'no-login',
  },
  codex: { state: 'usable', login: 'api-key', expiresAt: null },
}

/** ⚑ The bridge the Providers page reads. `signedOut`: Claude signed out, Codex on a saved key. */
export function providersBridge(signedOut = false): void {
  const auth = signedOut ? SIGNED_OUT_AND_KEY : SIGNED_IN
  const keySet = (provider: Provider) => signedOut && provider === 'codex'
  window.api = {
    runtime: {
      checkProviderAuth: async ({ provider }: { provider: Provider }) => auth[provider],
      reprovisionProviderAuth: async () => 'unchanged',
      signInProvider: async () => ({ success: true, state: null, detail: null }),
      cancelProviderSignIn: async () => undefined,
      apiKeyStatus: async ({ provider }: { provider: Provider }) => ({
        provider,
        set: keySet(provider),
        setAt: keySet(provider) ? NOW - 9 * 24 * HOUR : null,
        inUse: keySet(provider),
      }),
      setApiKey: async () => ({ ok: true }),
      removeApiKey: async () => ({ ok: true }),
      checkApiKey: async () => ({ ok: true }),
      providerVersions: async () => VERSIONS,
      // ⚑ What an *Always allow* kept: a command rule in one project, nothing for Codex.
      keptRules: async () => ({
        claude: [
          {
            file: '/Users/someone/work/site/.claude/settings.local.json',
            rules: [
              {
                kept: 'Bash(npm run test:*)',
                rule: { kind: 'tool', tool: 'Bash', content: 'npm run test:*' },
              },
              {
                kept: 'WebFetch(domain:docs.example.com)',
                rule: { kind: 'tool', tool: 'WebFetch', content: 'domain:docs.example.com' },
              },
            ],
          },
        ],
        codex: [],
      }),
      removeKeptRule: async () => ({ removed: true }),
      modelList: async ({ provider }: { provider: Provider }) => ({
        provider,
        notAsked: null,
        standIn: null,
        models: MODELS[provider].map((id) => ({
          id,
          label: id,
          efforts: [],
          addedBy: 'the-provider',
        })),
        lastPicked: null,
        startsOn: null,
      }),
      addHandAddedModel: async () => ({ ok: true }),
      deleteHandAddedModel: async () => ({ ok: true }),
      providerUsage: async () => (signedOut ? { claude: [], codex: USAGE.codex } : USAGE),
      providerResources: async () =>
        signedOut
          ? { claude: { running: 0, at: NOW, rssBytes: 0, cpuPercent: 0 }, codex: RESOURCES.codex }
          : RESOURCES,
      // ⚑ How each tool is installed and signed in here — main's facts, as on a Mac.
      providerSetup: async () => ({
        claude: {
          tool: 'Claude Code',
          install: {
            command: 'curl -fsSL https://claude.ai/install.sh | bash',
            docs: 'https://code.claude.com/docs/en/setup',
          },
          signInCommand: 'claude',
          platform: 'macOS',
          shell: 'Terminal',
        },
        codex: {
          tool: 'Codex',
          install: null,
          signInCommand: 'codex',
        },
      }),
      onProvidersChanged: () => () => {},
      listResumable: async () => [],
      listUnresumable: async () => [],
    },
  } as never
}
