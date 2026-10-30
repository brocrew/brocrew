import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keepToolApproval } from '../../../packages/runtime/src/codex/kept-tool-approvals'
import { readKeptRules, removeKeptRule, type WhereRulesAreKept } from '../src/main/kept-rules'

/**
 * What an *Always allow* kept beyond its conversation is listed where each provider keeps it, and a
 * person removes one rule from its file — that rule only, and only one the list holds. Scratch
 * folders and homes only; nothing here reads a real home.
 */

let root: string
let project: string
let claudeHome: string
let codexHome: string
let where: WhereRulesAreKept

const PROJECT_FILE = (): string => join(project, '.claude', 'settings.local.json')
const RULES_FILE = (): string => join(codexHome, 'rules', 'default.rules')
const APPROVAL = { server: 'docs', url: 'https://docs.example/mcp', tool: 'search' }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-kept-rules-'))
  project = join(root, 'project')
  claudeHome = join(root, 'homes', 'claude')
  codexHome = join(root, 'homes', 'codex')
  mkdirSync(join(project, '.claude'), { recursive: true })
  mkdirSync(claudeHome, { recursive: true })
  mkdirSync(join(codexHome, 'rules'), { recursive: true })
  writeFileSync(
    PROJECT_FILE(),
    `${JSON.stringify(
      {
        permissions: {
          allow: ['Bash(make build *)', 'mcp__brobot__give_work'],
          deny: ['Bash(rm -rf *)'],
        },
        theme: 'kept as it was',
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(claudeHome, 'settings.json'),
    JSON.stringify({ permissions: { allow: ['WebFetch(domain:example.com)'] } }),
  )
  writeFileSync(
    RULES_FILE(),
    [
      'prefix_rule(pattern=["git", "status"], decision="allow")',
      '# a line a person wrote',
      'network_rule(host="api.github.com", protocol="https", decision="allow")',
      '',
    ].join('\n'),
  )
  keepToolApproval(codexHome, APPROVAL)
  where = {
    projectFiles: {
      claude: [
        PROJECT_FILE(),
        join(root, 'a-folder-with-nothing-kept', '.claude', 'settings.local.json'),
      ],
      codex: [],
    },
    homes: [
      { provider: 'claude', path: claudeHome },
      { provider: 'codex', path: codexHome },
    ],
    personsOwn: [join(root, 'own', '.claude'), join(root, 'own', '.codex')],
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the list', () => {
  it('lists each provider’s allow rules, file by file, in the terms a card says them', () => {
    const kept = readKeptRules(where)
    expect(kept.claude).toEqual([
      {
        file: join(claudeHome, 'settings.json'),
        rules: [
          {
            kept: 'WebFetch(domain:example.com)',
            rule: { kind: 'tool', tool: 'WebFetch', content: 'domain:example.com' },
          },
        ],
      },
      {
        file: PROJECT_FILE(),
        rules: [
          {
            kept: 'Bash(make build *)',
            rule: { kind: 'tool', tool: 'Bash', content: 'make build *' },
          },
          {
            kept: 'mcp__brobot__give_work',
            rule: { kind: 'tool', tool: 'mcp__brobot__give_work' },
          },
        ],
      },
    ])
    // ⚑ Only the allow prefix rules a command's *Always allow* writes; a person's other lines are
    // left out of the list and kept in the file.
    expect(kept.codex).toEqual([
      {
        file: RULES_FILE(),
        rules: [
          {
            kept: 'prefix_rule(pattern=["git", "status"], decision="allow")',
            rule: { kind: 'command-prefix', prefix: ['git', 'status'] },
          },
        ],
      },
      {
        file: join(codexHome, 'brobot-kept-tool-approvals.json'),
        rules: [
          {
            kept: JSON.stringify(APPROVAL),
            rule: { kind: 'tool', tool: 'search', server: 'docs' },
          },
        ],
      },
    ])
  })

  it('says a file it cannot read, and lists nothing from it', () => {
    writeFileSync(PROJECT_FILE(), '{ not json')
    expect(readKeptRules(where).claude).toContainEqual({
      file: PROJECT_FILE(),
      rules: [],
      unreadable: 'it is not JSON',
    })
  })
})

describe('Remove', () => {
  it('takes one Claude rule out of its file, and leaves everything else in it as it was', () => {
    expect(
      removeKeptRule(where, {
        provider: 'claude',
        file: PROJECT_FILE(),
        kept: 'mcp__brobot__give_work',
      }),
    ).toEqual({ removed: true })
    expect(JSON.parse(readFileSync(PROJECT_FILE(), 'utf8'))).toEqual({
      permissions: { allow: ['Bash(make build *)'], deny: ['Bash(rm -rf *)'] },
      theme: 'kept as it was',
    })
  })

  it('takes one Codex prefix rule out, and leaves the lines it does not list', () => {
    const kept = 'prefix_rule(pattern=["git", "status"], decision="allow")'
    expect(removeKeptRule(where, { provider: 'codex', file: RULES_FILE(), kept })).toEqual({
      removed: true,
    })
    expect(readFileSync(RULES_FILE(), 'utf8')).toBe(
      [
        '# a line a person wrote',
        'network_rule(host="api.github.com", protocol="https", decision="allow")',
        '',
      ].join('\n'),
    )
  })

  it('forgets one kept MCP tool approval', () => {
    const file = join(codexHome, 'brobot-kept-tool-approvals.json')
    expect(
      removeKeptRule(where, { provider: 'codex', file, kept: JSON.stringify(APPROVAL) }),
    ).toEqual({ removed: true })
    expect(readKeptRules(where).codex.map((one) => one.file)).toEqual([RULES_FILE()])
  })

  it('refuses a file or a rule the list does not hold, and changes nothing', () => {
    const before = readFileSync(PROJECT_FILE(), 'utf8')
    const elsewhere = join(root, 'not-listed.json')
    writeFileSync(elsewhere, JSON.stringify({ permissions: { allow: ['Bash'] } }))
    expect(
      removeKeptRule(where, { provider: 'claude', file: elsewhere, kept: 'Bash' }),
    ).toMatchObject({ removed: false })
    expect(
      removeKeptRule(where, { provider: 'claude', file: PROJECT_FILE(), kept: 'Bash(ls *)' }),
    ).toMatchObject({ removed: false })
    // ⚑ A rule asked for under the other provider is not that provider's either.
    expect(
      removeKeptRule(where, {
        provider: 'codex',
        file: PROJECT_FILE(),
        kept: 'Bash(make build *)',
      }),
    ).toMatchObject({ removed: false })
    expect(readFileSync(PROJECT_FILE(), 'utf8')).toBe(before)
    expect(readFileSync(elsewhere, 'utf8')).toContain('Bash')
  })

  it('removes a rule from the file a link leads to, and keeps the link', () => {
    const real = join(root, 'real-settings.json')
    writeFileSync(real, JSON.stringify({ permissions: { allow: ['Bash(make *)'] } }))
    const linked = join(root, 'linked')
    mkdirSync(join(linked, '.claude'), { recursive: true })
    symlinkSync(real, join(linked, '.claude', 'settings.local.json'))
    const there = {
      ...where,
      projectFiles: { claude: [join(linked, '.claude', 'settings.local.json')], codex: [] },
    }
    const said = removeKeptRule(there, {
      provider: 'claude',
      file: join(linked, '.claude', 'settings.local.json'),
      kept: 'Bash(make *)',
    })
    expect(said).toEqual({ removed: true })
    expect(readFileSync(real, 'utf8')).not.toContain('Bash(make *)')
    expect(lstatSync(join(linked, '.claude', 'settings.local.json')).isSymbolicLink()).toBe(true)
  })

  it('removes a rule through a linked `.claude` folder too', () => {
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(
      join(elsewhere, 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(make *)'] } }),
    )
    const linked = join(root, 'linked-folder')
    mkdirSync(linked)
    symlinkSync(elsewhere, join(linked, '.claude'))
    const said = removeKeptRule(
      {
        ...where,
        projectFiles: { claude: [join(linked, '.claude', 'settings.local.json')], codex: [] },
      },
      {
        provider: 'claude',
        file: join(linked, '.claude', 'settings.local.json'),
        kept: 'Bash(make *)',
      },
    )
    expect(said).toEqual({ removed: true })
    expect(readFileSync(join(elsewhere, 'settings.local.json'), 'utf8')).not.toContain(
      'Bash(make *)',
    )
  })

  it('removes a rule from a file with a second name, under both names, and keeps the mode of one it rewrites', () => {
    const other = join(root, 'second-name.json')
    linkSync(PROJECT_FILE(), other)
    expect(
      removeKeptRule(where, {
        provider: 'claude',
        file: PROJECT_FILE(),
        kept: 'Bash(make build *)',
      }),
    ).toEqual({ removed: true })
    expect(readFileSync(other, 'utf8')).toBe(readFileSync(PROJECT_FILE(), 'utf8'))
    expect(readFileSync(other, 'utf8')).not.toContain('Bash(make build *)')
    rmSync(other)
    writeFileSync(
      PROJECT_FILE(),
      JSON.stringify({ permissions: { allow: ['Bash(make build *)'] } }),
    )
    chmodSync(PROJECT_FILE(), 0o644)
    expect(
      removeKeptRule(where, {
        provider: 'claude',
        file: PROJECT_FILE(),
        kept: 'Bash(make build *)',
      }),
    ).toEqual({ removed: true })
    // Windows uses access lists; chmod does not supply POSIX permission bits.
    if (process.platform !== 'win32') expect(statSync(PROJECT_FILE()).mode & 0o777).toBe(0o644)
  })
})

describe('as the files are written', () => {
  it('lists a rule written twice once, and Remove takes both', () => {
    writeFileSync(
      PROJECT_FILE(),
      JSON.stringify({ permissions: { allow: ['Bash(ls *)', 'Bash(ls *)'] } }),
    )
    const listed = readKeptRules(where).claude.find((one) => one.file === PROJECT_FILE())
    expect(listed?.rules.map((one) => one.kept)).toEqual(['Bash(ls *)'])
    expect(
      removeKeptRule(where, { provider: 'claude', file: PROJECT_FILE(), kept: 'Bash(ls *)' }),
    ).toEqual({ removed: true })
    expect(JSON.parse(readFileSync(PROJECT_FILE(), 'utf8'))).toEqual({ permissions: { allow: [] } })
  })

  it('reads a rules file written with Windows line endings, and keeps them', () => {
    writeFileSync(
      RULES_FILE(),
      'prefix_rule(pattern=["git", "status"], decision="allow")\r\n# kept\r\n',
    )
    const kept = 'prefix_rule(pattern=["git", "status"], decision="allow")'
    expect(readKeptRules(where).codex[0]?.rules.map((one) => one.kept)).toEqual([kept])
    expect(removeKeptRule(where, { provider: 'codex', file: RULES_FILE(), kept })).toEqual({
      removed: true,
    })
    expect(readFileSync(RULES_FILE(), 'utf8')).toBe('# kept\r\n')
  })

  it('lists a file in the person’s own provider folder, says so, and never rewrites it', () => {
    // ⚑ A conversation run in the home folder keeps its project settings in the person's own one.
    const home = join(root, 'own')
    mkdirSync(join(home, '.claude'), { recursive: true })
    const own = join(home, '.claude', 'settings.local.json')
    writeFileSync(own, JSON.stringify({ permissions: { allow: ['Bash(make *)'] } }))
    const there = { ...where, projectFiles: { claude: [own], codex: [] } }
    const listed = readKeptRules(there).claude.find((one) => one.file === own)
    expect(listed?.rules.map((one) => one.kept)).toEqual(['Bash(make *)'])
    expect(listed?.notEditedHere).toContain('your own provider folder')
    const said = removeKeptRule(there, { provider: 'claude', file: own, kept: 'Bash(make *)' })
    expect(said.removed === false && said.why).toContain('your own provider folder')
    expect(JSON.parse(readFileSync(own, 'utf8'))).toEqual({
      permissions: { allow: ['Bash(make *)'] },
    })
  })
})
