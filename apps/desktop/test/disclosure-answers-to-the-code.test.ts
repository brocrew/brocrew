import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CODEX_MEMORY_SETTINGS,
  mergeCodexMemoryConfig,
  SUPPORTED_PROVIDERS,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  CLAUDE_SDK_OPTIONS,
  CODEX_THREAD_START_CLAIMS,
  readProviderConfig,
  type SdkOptionClaim,
} from '../src/main/runtime/provider-config'


const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const read = (relative: string): string => readFileSync(join(REPO, relative), 'utf8')

const ADAPTER: Record<Provider, string> = {
  claude: 'packages/runtime/src/claude/claude-runtime.ts',
  codex: 'packages/runtime/src/codex/codex-runtime.ts',
}

function optionsPassedBy(source: string): Set<string> {
  const start = source.indexOf('  private optionsFor(')
  if (start < 0) throw new Error('optionsFor is gone from the Claude adapter')
  const body = source.slice(start, source.indexOf('\n  }\n', start))
  const literalStart = body.search(
    /const options: (?:Options|Omit<Options, 'settings'> & \{ settings: Settings \}) = \{/,
  )
  if (literalStart < 0) throw new Error('optionsFor no longer builds an Options literal')
  const literal = body.slice(literalStart, body.indexOf('\n    }\n', literalStart))
  return new Set([
    ...[...literal.matchAll(/^ {6}([A-Za-z_$][\w$]*)\s*[:,]/gm)].map((m) => m[1]!),
    ...[...body.matchAll(/\boptions\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]!),
  ])
}

const PASSED = optionsPassedBy(read(ADAPTER.claude))

function disagreements(
  claims: readonly SdkOptionClaim[],
  passed: ReadonlySet<string>,
): readonly string[] {
  return claims
    .filter((claim) => (claim.stance === 'absent') === passed.has(claim.option))
    .map((claim) =>
      claim.stance === 'absent'
        ? `${claim.option}: the block says it is NOT passed, and optionsFor sets it`
        : `${claim.option}: the block says it is ${claim.stance}, and optionsFor never sets it`,
    )
}

const namesMcp = (text: string): boolean => /\bmcp\b/i.test(text)

const camelWords = (text: string): string[] =>
  text.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g) ?? []

const NOT_AN_OPTION = ['macOS']

const claudeBlock = readProviderConfig('claude', '/nowhere')
const CLAUDE_PROSE = [
  claudeBlock.model,
  claudeBlock.authNote ?? '',
  ...claudeBlock.files.map((file) => file.note),
]

describe('the provider disclosure answers to the adapter (308)', () => {
  it('⛔ every option the Claude block names as passed is set, and every one it calls absent is not', () => {
    expect(
      disagreements(CLAUDE_SDK_OPTIONS, PASSED),
      'the config block is telling the user something about this session that the adapter does ' +
        'not do. Correct the row in `provider-config.ts` — the sentence is rendered from it.',
    ).toEqual([])
    for (const claim of CLAUDE_SDK_OPTIONS) {
      expect(claudeBlock.model, `the sentence stopped naming ${claim.option}`).toContain(
        claim.label,
      )
    }
  })

  it('⚑ and the roster is real — the scan read an options block, not an empty file (193)', () => {
    expect(CLAUDE_SDK_OPTIONS.length).toBeGreaterThan(0)
    expect(CLAUDE_SDK_OPTIONS.map((claim) => claim.option)).toContain('mcpServers')
    expect([...PASSED].sort()).toEqual(
      expect.arrayContaining([
        'canUseTool',
        'cwd',
        'env',
        'hooks',
        'model',
        'permissionMode',
        'settingSources',
        'settings',
        'strictMcpConfig',
        'systemPrompt',
        'tools',
      ]),
    )
    const source = read(ADAPTER.claude)
    const start = source.indexOf('  private optionsFor(')
    expect(start).toBeGreaterThan(-1)
    expect(source.indexOf('  private optionsFor(', start + 1)).toBe(-1)
    const literal = /const options: (?:Options|Omit<Options, 'settings'> & \{ settings: Settings \}) = \{/.exec(
      source.slice(start),
    )
    expect(literal).not.toBeNull()
    if (!literal) throw new Error('optionsFor has no Options literal')
    const insertion = start + literal.index + literal[0].length
    const plant = (member: string): string =>
      source.slice(0, insertion) + `\n      ${member}` + source.slice(insertion)
    const decoy = plant('// forwardSubagentText: true,')
    expect(decoy).not.toBe(source)
    expect(decoy).toContain('// forwardSubagentText: true,')
    expect([...optionsPassedBy(decoy)].sort()).toEqual([...PASSED].sort())
    expect(optionsPassedBy(decoy).has('forwardSubagentText')).toBe(false)
    const changed = plant('forwardSubagentText: true,')
    expect([...optionsPassedBy(changed)].sort()).toEqual(
      [...PASSED, 'forwardSubagentText'].sort(),
    )
    expect(PASSED.has('forwardSubagentText')).toBe(false)
    expect(PASSED.has('effort')).toBe(false)
  })

  it('🔴 no camelCase word in the Claude block names something the adapter does not pass', () => {
    const undeclared = CLAUDE_PROSE.flatMap(camelWords)
      .filter((word) => !PASSED.has(word) && !NOT_AN_OPTION.includes(word))
      .sort()
    expect(
      [...new Set(undeclared)],
      'the block spells an SDK option the adapter never sets. If it is not an option at all, add ' +
        'it to NOT_AN_OPTION with a reason.',
    ).toEqual([])
    const source = read(ADAPTER.claude)
    const body = source.slice(source.indexOf('  private optionsFor('))
    const claimed = CLAUDE_SDK_OPTIONS.map((claim) => claim.option)
    for (const word of NOT_AN_OPTION) {
      expect(body.slice(0, body.indexOf('\n  }\n')).includes(word), `${word} is not prose`).toBe(
        false,
      )
      expect(claimed, `${word} is an option this very block makes a claim about`).not.toContain(
        word,
      )
    }
    expect(camelWords('the adapter pins settingSources: [] and strictMcpConfig: true')).toEqual([
      'settingSources',
      'strictMcpConfig',
    ])
    expect(CLAUDE_PROSE.flatMap(camelWords).length).toBeGreaterThan(0)
  })

  it('⛔ MCP is named in exactly one Claude string, and it is the one the table renders', () => {
    expect(
      CLAUDE_PROSE.filter(namesMcp),
      'a Claude disclosure string names MCP outside the sentence rendered from CLAUDE_SDK_OPTIONS, ' +
        'so nothing checks it against the adapter.',
    ).toEqual([claudeBlock.model])
  })

  it('⚠️ each provider block names the env var its own adapter pins to the provider home', () => {
    const pins = (homeEnv: string, source: string): boolean =>
      new RegExp(String.raw`\b${homeEnv}\s*:\s*[\w.]*[pP]roviderHome\b`).test(source)
    for (const provider of SUPPORTED_PROVIDERS) {
      const block = readProviderConfig(provider, '/nowhere')
      expect(
        pins(block.homeEnv, read(ADAPTER[provider])),
        `${provider}: the block tells the user to set ${block.homeEnv}, and the adapter does not ` +
          'point that variable at the provider home',
      ).toBe(true)
      expect(pins(`${block.homeEnv}_NOT_A_REAL_VAR`, read(ADAPTER[provider]))).toBe(false)
    }
  })

  it('⚠️ the Codex block names the files the code names', () => {
    const owners =
      read('packages/runtime/src/internal/auth.ts') +
      read('packages/runtime/src/codex/stale-permission-config.ts') +
      read('packages/runtime/src/codex/kept-tool-approvals.ts') +
      read('packages/runtime/src/codex/codex-runtime.ts')
    const files = readProviderConfig('codex', '/nowhere').files
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(owners).toContain(`= '${file.name}'`)
  })
})

describe('…and the check is as wide as it claims (308 §3)', () => {
  const SYNTHETIC = [
    '  private optionsFor(handle: H): Options {',
    '    const earlier: Other = {',
    '      notAnOption: 1,',
    '    }',
    '    const options: Options = {',
    '      cwd,',
    '      tools: [...VOCABULARY],',
    '      hooks: {',
    '        Stop: nested,',
    '      },',
    '    }',
    '    options.systemPrompt = {',
    "      type: 'preset',",
    "      preset: 'claude_code',",
    '    }',
    '    return options',
    '  }',
    '',
  ].join('\n')

  it('⛔ the scan takes top-level Options keys and nothing else', () => {
    expect([...optionsPassedBy(SYNTHETIC)].sort()).toEqual([
      'cwd',
      'hooks',
      'systemPrompt',
      'tools',
    ])
  })

  it('⛔ catches a rewording, not the literal the defect happened to use', () => {
    expect(namesMcp('MCP servers, tools and prompt are passed as SDK query() options')).toBe(true)
    expect(namesMcp('mcp servers are forwarded to the child')).toBe(true)
    expect(namesMcp('MCP-server config is handed over at launch')).toBe(true)
    expect(namesMcp('add an Mcp server here')).toBe(true)
  })

  it('⚠️ and does NOT fire on the pin, which is where the casing trap lives', () => {
    expect(namesMcp('the adapter pins settingSources: [] and strictMcpConfig: true')).toBe(false)
    expect(namesMcp('file settings here are ignored by design')).toBe(false)
  })

  it('⚑ the Slice 3 flip HAPPENED, and the census is what agrees it did (347)', () => {
    expect(CLAUDE_SDK_OPTIONS.find((claim) => claim.option === 'mcpServers')?.stance).toBe('passed')
    expect(PASSED.has('mcpServers')).toBe(true)
    expect(CLAUDE_SDK_OPTIONS.find((claim) => claim.option === 'mcpServers')?.label).toContain(
      'external servers granted to it',
    )
    expect(disagreements(CLAUDE_SDK_OPTIONS, PASSED)).toEqual([])
  })

  it('🔴 and the disclosure goes red if the adapter STOPS passing them behind its back', () => {
    expect(
      disagreements(
        CLAUDE_SDK_OPTIONS,
        new Set([...PASSED].filter((option) => option !== 'mcpServers')),
      ),
    ).toEqual(['mcpServers: the block says it is passed, and optionsFor never sets it'])
  })

  it('⚠️ and a table that flipped the row back would be caught by the same rule', () => {
    const reverted: SdkOptionClaim[] = CLAUDE_SDK_OPTIONS.map((claim) =>
      claim.option === 'mcpServers' ? { ...claim, stance: 'absent' as const } : claim,
    )
    expect(disagreements(reverted, PASSED)).toEqual([
      'mcpServers: the block says it is NOT passed, and optionsFor sets it',
    ])
  })
})

describe('the Codex disclosure answers to the writer (314)', () => {
  const keysIn = (text: string): string[] => {
    const found: string[] = []
    let table = ''
    for (const line of text.split('\n')) {
      const header = /^\[([A-Za-z0-9_-]+)\]\s*$/.exec(line.trim())
      if (header) {
        table = header[1]!
        continue
      }
      const assign = /^([A-Za-z0-9_-]+)\s*=/.exec(line)
      if (assign && table !== '') found.push(`${table}.${assign[1]!}`)
    }
    return found
  }

  const merged = mergeCodexMemoryConfig(null)
  const WRITTEN = merged.kind === 'merged' ? keysIn(merged.text) : []
  const codexBlock = readProviderConfig('codex', '/nowhere')

  it('⛔ every key the block names is one the writer really writes, and every one it writes is named', () => {
    expect(
      WRITTEN.slice().sort(),
      'the config block names a different set of memory keys than the merge writes. Correct ' +
        '`CODEX_MEMORY_SETTINGS` — both the sentence and the file’s comments are rendered from it.',
    ).toEqual(CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}`).sort())
    for (const key of WRITTEN) {
      expect(codexBlock.model, `the sentence stopped naming ${key}`).toContain(key)
    }
  })

  it('⚑ …and the roster is real — the merge produced a file, not an empty string (193)', () => {
    expect(merged.kind).toBe('merged')
    expect(CODEX_MEMORY_SETTINGS.length).toBeGreaterThan(0)
    expect(WRITTEN).toContain('features.memories')
    expect(WRITTEN).toContain('memories.dedicated_tools')
    expect(keysIn('[features]\nmemories = true\nsomething_else = 1\n')).toEqual([
      'features.memories',
      'features.something_else',
    ])
    expect(keysIn('loose = 1\n')).toEqual([])
  })

  it('🔴 the sentence names no memory key the writer does not write', () => {
    const prose = [
      codexBlock.model,
      codexBlock.authNote ?? '',
      ...codexBlock.files.map((file) => file.note),
    ].join(' ')
    const dotted = prose.match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g) ?? []
    const undeclared = dotted.filter(
      (word) => !WRITTEN.includes(word) && !codexBlock.files.some((file) => file.name === word),
    )
    expect(
      [...new Set(undeclared)],
      'the Codex block spells a config key the app does not write into config.toml.',
    ).toEqual([])
    expect(
      'features.memories and memories.use_memories'.match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g),
    ).toEqual(['features.memories', 'memories.use_memories'])
    expect(dotted.length).toBeGreaterThan(0)
  })

  it('⚠️ the block no longer says an absent config.toml means built-in defaults', () => {
    const notes = codexBlock.files.map((file) => file.note).join(' ')
    expect(notes).not.toContain('absent means built-in defaults')
  })
})

const PANEL = 'apps/desktop/src/renderer/src/components/SessionInstructions.vue'

function renderedStrings(source: string): string {
  return source
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const namesAProvider = (text: string): string[] =>
  SUPPORTED_PROVIDERS.filter((provider) => new RegExp(`\\b${provider}\\b`, 'i').test(text))

describe('the instructions panel names no provider (317)', () => {
  it('⛔ no string a user reads on this panel names Claude or Codex', () => {
    expect(namesAProvider(renderedStrings(read(PANEL)))).toEqual([])
  })

  it('⚑ …and the scan really reads this file — the roster is not empty (193)', () => {
    const rendered = renderedStrings(read(PANEL))
    expect(rendered).toContain('agent memory — written by the agent, loaded by the provider')
    expect(rendered).toContain('a note the agent was asked to write')
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(1)
  })

  it('🔴 …and it CATCHES the sentence that actually shipped, not a literal it was tuned to', () => {
    const shipped = read(PANEL).replace(
      "'agent memory — written by the agent, loaded by the provider'",
      "'agent memory — written by the agent, loaded by Claude itself'",
    )
    expect(namesAProvider(renderedStrings(shipped))).toEqual(['claude'])
    const other = read(PANEL).replace(
      'a note the agent was asked to write',
      'a note Codex was asked to write',
    )
    expect(namesAProvider(renderedStrings(other))).toEqual(['codex'])
  })

  it('⚠️ …and does NOT fire on the reasoning, which names both on purpose', () => {
    const source = read(PANEL)
    const opening = '<script setup lang="ts">'
    expect(source.split(opening)).toHaveLength(2)
    const decoy = source.replace(opening, `${opening}\n// Claude and Codex comment control\n`)
    expect(decoy).not.toBe(source)
    expect(decoy).toContain('// Claude and Codex comment control')
    expect(namesAProvider(decoy).sort()).toEqual(['claude', 'codex'])
    expect(namesAProvider(renderedStrings(decoy))).toEqual([])
    expect(renderedStrings(decoy)).toContain(
      'agent memory — written by the agent, loaded by the provider',
    )
    expect(namesAProvider(renderedStrings(source))).toEqual([])
  })
})

describe('the Codex disclosure answers to thread/start (348)', () => {
  const codexBlock = readProviderConfig('codex', '/nowhere')
  const adapter = read(ADAPTER.codex)

  const sets = (field: string): boolean =>
    new RegExp(String.raw`\bparams\.${field}\s*=(?!=)`).test(adapter)

  it('⛔ every field the block claims is one the adapter really puts on thread/start', () => {
    expect(CODEX_THREAD_START_CLAIMS.length).toBeGreaterThan(0)
    for (const claim of CODEX_THREAD_START_CLAIMS) {
      expect(claim.stance, `${claim.option} is claimed but not passed`).toBe('passed')
      expect(
        sets(claim.option),
        `the block claims ${claim.option} and the adapter never sets it`,
      ).toBe(true)
      expect(codexBlock.model, `the sentence stopped naming ${claim.label}`).toContain(claim.label)
    }
  })

  it('⚑ …and the matcher can say no, on the same source (193)', () => {
    expect(sets('dynamicToolsNotARealField')).toBe(false)
    expect(sets('model')).toBe(true)
  })

  it('🔴 the block does not claim the tools are in the file, because they are not', () => {
    expect(codexBlock.model).toContain('not in that file')
    expect(codexBlock.model).toContain('declared on the wire')
    expect(codexBlock.model).not.toMatch(/declared in that file/)
    const configFile = codexBlock.files.find((one) => one.name === 'config.toml')
    expect(configFile, 'the Codex block still names config.toml').toBeDefined()
    expect(configFile!.note).not.toContain("this session's own tools")
  })
})
