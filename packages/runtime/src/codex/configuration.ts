import { humanList, type ProviderConfigLayout, type SdkOptionClaim } from '../provider-configuration'
import { CODEX_MEMORY_SETTINGS } from './memory-settings'


const CODEX_MEMORY_KEYS = CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}`)


export const CODEX_THREAD_START_CLAIMS: readonly SdkOptionClaim[] = [
  {
    option: 'dynamicTools',
    label: "this session's own tools",
    stance: 'passed',
  },
  {
    option: 'config',
    label:
      "the external MCP servers this identity was granted, and Codex's planning tool switched on",
    stance: 'passed',
  },
]

const CODEX_MODEL_NOTE =
  'file-based — config.toml in this home is where Codex reads its own MCP servers and ' +
  `preferences, and where BroCrew switches this profile's memory on: ${humanList(CODEX_MEMORY_KEYS)} ` +
  'are merged into the tables already there on every launch, and nothing else in the file is ' +
  `touched — and ${humanList(CODEX_THREAD_START_CLAIMS.map((claim) => claim.label))} are not in ` +
  'that file at all: they are declared on the wire when the conversation starts. The tools the ' +
  'app-server remembers, so a resumed conversation comes back with the same ones; the servers and ' +
  'the planning switch it does not, so BroCrew sends them again every time it reopens the conversation'

export const CODEX_CONFIG_LAYOUT: ProviderConfigLayout = {
  homeEnv: 'CODEX_HOME',
  model: CODEX_MODEL_NOTE,
  authNote: null,
  files: [
    {
      name: 'auth.json',
      note: 'the credential this profile runs on — copied from ~/.codex, or minted here by "Sign in for this agent"',
    },
    {
      name: 'config.toml',
      note: 'MCP servers + preferences, and the memory keys above — Codex writes here too, so BroCrew merges and never rewrites it',
    },
    {
      name: 'brobot-kept-tool-approvals.json',
      note: 'MCP tools always allowed here — declared with their server at every launch, so Codex does not ask about them',
    },
    {
      name: 'rules/default.rules',
      note: 'Codex\'s own "don\'t ask again for commands that start with …" rules — Codex writes and reads them itself',
    },
  ],
}