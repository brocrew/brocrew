import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, type Component } from 'vue'
import KeptRules from '../../src/renderer/src/components/KeptRules.vue'
import type { KeptRules as Kept } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * The Providers page lists what an *Always allow* kept, per provider and file by file, each rule in
 * the words its card said, with a Remove that names the file and the rule and reads the list again.
 */

afterEach(unmountAll)

const PROJECT = '/work/app/.claude/settings.local.json'
const RULES = '/data/homes/default/worker/codex/rules/default.rules'

const KEPT: Kept = {
  claude: [
    {
      file: PROJECT,
      rules: [
        {
          kept: 'Bash(make build *)',
          rule: { kind: 'tool', tool: 'Bash', content: 'make build *' },
        },
        { kept: 'mcp__docs__search', rule: { kind: 'tool', tool: 'mcp__docs__search' } },
      ],
    },
  ],
  codex: [
    {
      file: RULES,
      rules: [
        {
          kept: 'prefix_rule(pattern=["git", "status"], decision="allow")',
          rule: { kind: 'command-prefix', prefix: ['git', 'status'] },
        },
      ],
    },
  ],
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

function aPage(answers: Kept[], removed: { removed: true } | { removed: false; why: string }) {
  const asked: unknown[] = []
  let reads = 0
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      keptRules: () => Promise.resolve(answers[Math.min(reads++, answers.length - 1)]),
      removeKeptRule: (input: unknown) => {
        asked.push(input)
        return Promise.resolve(removed)
      },
    },
  }
  const m = mount(
    KeptRules as Component,
    { providers: ['claude', 'codex'] },
    {
      width: 900,
      height: 700,
    },
  )
  return { m, asked, reads: () => reads }
}

describe('kept rules on the Providers page', () => {
  it('lists each provider’s rules, file by file, in the words a card says them', async () => {
    const { m } = aPage([KEPT], { removed: true })
    await settle()
    expect(m.host.textContent).toContain('per provider')
    expect(m.host.textContent).toContain('does not carry to another provider')
    expect(m.all('kept-rules-file').map((one) => one.textContent?.trim())).toEqual([PROJECT, RULES])
    expect(
      m.all('kept-rule').map((one) => one.querySelector('.rule')?.textContent?.trim()),
    ).toEqual([
      'commands starting with make build (Bash(make build *))',
      'every mcp__docs__search call',
      'commands starting with git status',
    ])
    expect(m.all('kept-rules-none')).toEqual([])
  })

  it('Remove names the provider, the file and the rule, and the list is read again', async () => {
    const { m, asked, reads } = aPage([KEPT, { ...KEPT, codex: [] }], { removed: true })
    await settle()
    const remove = m.all('kept-rule-remove')[2]
    if (remove === undefined) throw new Error('no Remove on the Codex rule')
    remove.click()
    await settle()
    expect(asked).toEqual([
      {
        provider: 'codex',
        file: RULES,
        kept: 'prefix_rule(pattern=["git", "status"], decision="allow")',
      },
    ])
    expect(reads()).toBe(2)
    const codex = m.all('kept-rules-provider').find((one) => one.dataset['provider'] === 'codex')
    expect(codex?.querySelector('[data-cy="kept-rules-none"]')?.textContent?.trim()).toBe(
      'None kept.',
    )
    expect(m.all('kept-rules-refused')).toEqual([])
  })

  it('a refused Remove says why, and the rule stays listed', async () => {
    const { m } = aPage([KEPT], { removed: false, why: 'That rule is no longer kept there.' })
    await settle()
    m.all('kept-rule-remove')[0]?.click()
    await settle()
    expect(m.q('kept-rules-refused').textContent?.trim()).toBe(
      'Not removed: That rule is no longer kept there.',
    )
    expect(m.all('kept-rule')).toHaveLength(3)
  })

  it('a file this app does not edit lists its rules with no Remove, and says why', async () => {
    const own: Kept = {
      claude: [{ ...KEPT.claude[0]!, notEditedHere: 'it is in your own provider folder' }],
      codex: [],
    }
    const { m } = aPage([own], { removed: true })
    await settle()
    expect(m.all('kept-rule')).toHaveLength(2)
    expect(m.all('kept-rule-remove')).toEqual([])
    expect(m.q('kept-rules-not-here').textContent?.trim()).toBe(
      'Remove a rule from this file yourself: it is in your own provider folder.',
    )
  })
})
