import { humanList, type ProviderConfigLayout, type SdkOptionClaim } from '../provider-configuration'
type OptionStance = SdkOptionClaim['stance']
export const CLAUDE_SDK_OPTIONS: readonly SdkOptionClaim[] = [
  { option: 'tools', label: 'tools', stance: 'passed' },
  { option: 'systemPrompt', label: 'the prompt', stance: 'passed' },
  { option: 'settingSources', label: 'settingSources: []', stance: 'pinned' },
  { option: 'strictMcpConfig', label: 'strictMcpConfig: true', stance: 'pinned' },
  {
    option: 'mcpServers',
    label: "this session's own tools and any external servers granted to it, as MCP servers",
    stance: 'passed',
  },
  {
    option: 'settings',
    label:
      "the permission rules kept in this home's settings.json and in the project's .claude/settings.local.json",
    stance: 'passed',
  },
]




const labelsFor = (stance: OptionStance): string[] =>
  CLAUDE_SDK_OPTIONS.filter((claim) => claim.stance === stance).map((claim) => claim.label)


const CLAUDE_MODEL_NOTE =
  `programmatic — ${humanList(labelsFor('passed'))} are passed as SDK query() options; ` +
  `the adapter pins ${humanList(labelsFor('pinned'))}, so other file settings here are ignored by design.` +
  (labelsFor('absent').length === 0
    ? ''
    : ` ${humanList(labelsFor('absent'))}: NOT passed — this app configures none, and the pins above` +
      ` mean none are read from a file either`)


export const CLAUDE_CONFIG_LAYOUT: ProviderConfigLayout = {
  homeEnv: 'CLAUDE_CONFIG_DIR',
  model: CLAUDE_MODEL_NOTE,
  authNote:
    'auth: Claude Code’s own login (the Keychain on a Mac, its own file on Windows) — the token is injected per launch, never written here',
  files: [
    { name: '.claude.json', note: "the SDK's own state — not a file you edit to add tools" },
    {
      name: 'settings.json',
      note: "this identity's own settings — its permission rules are read at every launch, and nothing else in it is loaded; a rule chosen to outlive one conversation is kept in the project's .claude/settings.local.json, where the CLI keeps it",
    },
  ],
}

