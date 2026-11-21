import { newConversationGive } from './lib/give-fixture'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import {
  capabilitiesFor,
  PROTECTIONS,
  SUPPORTED_PROVIDERS,
  WHAT_STANDS_PAST_ITS_FOLDER,
  type ApprovalMode,
  type Protection,
} from '@brobot2/runtime'
import {
  admitGive,
  type GiveAdmission,
  type GivingConversation,
} from '../src/main/runtime/spawn-rails'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { giveFactsForTest as factsWith } from './lib/give-facts-fixture'
import { YOLO_MEANS, YOLO_MEANS_FOR_AGENTS_IT_STARTS } from '../src/renderer/src/lib/approval-mode'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const RUNTIME = join(REPO, 'packages/runtime/src')
const CLAUDE_ADAPTER = [
  'claude/claude-runtime.ts',
  'claude/claude-session-handle.ts',
  'claude/permission-offers.ts',
]

function whatAutoTakesOff(provider: Provider): Protection[] {
  const { ask, auto } = WHAT_STANDS_PAST_ITS_FOLDER[provider]
  return ask.filter((one) => !auto.includes(one))
}

const MODES: readonly ApprovalMode[] = ['ask', 'auto']

describe('§1 · what each provider mode keeps past its folder', () => {
  it('⛔ the table is TOTAL — every provider, every mode, from the vocabularies', () => {
    expect(Object.keys(WHAT_STANDS_PAST_ITS_FOLDER).sort()).toEqual([...SUPPORTED_PROVIDERS].sort())
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(Object.keys(WHAT_STANDS_PAST_ITS_FOLDER[provider]).sort()).toEqual([...MODES].sort())
      for (const mode of MODES) {
        for (const protection of WHAT_STANDS_PAST_ITS_FOLDER[provider][mode]) {
          expect(PROTECTIONS).toContain(protection)
        }
      }
    }
  })

  it('⚑ `auto` keeps nothing past its folder on either provider — the fact F050 turned on', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(WHAT_STANDS_PAST_ITS_FOLDER[provider].auto, provider).toEqual([])
      expect(WHAT_STANDS_PAST_ITS_FOLDER[provider].ask.length, provider).toBeGreaterThan(0)
    }
  })

  it('🔴 `auto` is NOT the same act on the two providers — the measurement this dispatch is about', () => {
    expect(whatAutoTakesOff('claude')).toEqual(['the-card-before-an-act'])
    expect(whatAutoTakesOff('codex')).toEqual([
      'the-card-before-an-act',
      'the-sandbox-around-an-act',
    ])
    const claude = new Set(whatAutoTakesOff('claude'))
    const codex = new Set(whatAutoTakesOff('codex'))
    expect([...claude].every((one) => codex.has(one))).toBe(true)
    expect(codex.size).toBeGreaterThan(claude.size)
  })
})

describe('§2 · the table says what the adapters DO, and each half is bound differently', () => {
  it('⛔ the CLAUDE row is a NEGATIVE, and this is the search shape behind it', () => {
    const claude = CLAUDE_ADAPTER.map((file) => readFileSync(join(RUNTIME, file), 'utf8')).join(
      '\n',
    )
    const code = withoutProse(claude)

    expect(code).toContain("return planMode ? 'plan' : 'default'")
    expect(code).toContain('permissionMode: permissionModeFor(planMode === true)')
    const contaminated = `${claude}\n// permissionMode: 'bypassPermissions'\n/* allowDangerouslySkipPermissions: true; sandbox: {} */`
    expect(contaminated).toContain('bypassPermissions')
    expect(withoutProse(contaminated).trim()).toBe(code.trim())
    expect(withoutProse(`${claude}\noptions.permissionMode = 'bypassPermissions'`)).toContain(
      'bypassPermissions',
    )
    expect(withoutProse(`${claude}\noptions.allowDangerouslySkipPermissions = true`)).toContain(
      'allowDangerouslySkipPermissions',
    )
    expect(withoutProse(`${claude}\nconst sandbox = {}`)).toMatch(/sandbox\s*[:=]/i)
    expect(code).not.toContain('bypassPermissions')
    expect(code).not.toContain('allowDangerouslySkipPermissions')

    for (const file of [...CLAUDE_ADAPTER, 'claude/claude-child.ts']) {
      expect(withoutProse(readFileSync(join(RUNTIME, file), 'utf8')), file).not.toMatch(
        /sandbox\s*[:=]/i,
      )
    }
    for (const mode of MODES) {
      expect(WHAT_STANDS_PAST_ITS_FOLDER.claude[mode], mode).not.toContain(
        'the-sandbox-around-an-act',
      )
    }
    expect(code).toContain(
      'if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {',
    )
    expect(code).toContain('() => handle.approval.effective')
  })
})

describe('§3 · the table and the two sentences a person reads say the same thing', () => {
  it('🔴 each provider`s own approvals note names the sandbox iff the table does', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const status = capabilitiesFor(provider).approvals
      expect(status.state, provider).toBe('available')
      const note = status.state === 'available' ? (status.note ?? '') : ''
      expect(note, provider).not.toBe('')
      const saysSandboxComesOff = /takes the sandbox off|sandbox at all/i.test(note)
      const tableSaysSo = whatAutoTakesOff(provider).includes('the-sandbox-around-an-act')
      expect(saysSandboxComesOff, `${provider}: "${note}"`).toBe(tableSaysSo)
      expect(/card|approvals? on|nothing is asked|approvals off/i.test(note), provider).toBe(
        whatAutoTakesOff(provider).includes('the-card-before-an-act'),
      )
    }
  })

  it('⚠️ the CLAUDE note refuses the sandbox clause outright, which is the dangerous direction', () => {
    const claude = capabilitiesFor('claude').approvals
    const note = claude.state === 'available' ? (claude.note ?? '') : ''
    expect(note).toContain('nothing is sandboxed in either mode')
    expect(note).toContain('What this mode removes is the card')
  })
})

describe('§4 · the sentence the PO ruled owed, and it is derived rather than typed', () => {
  it('🔴 it names every provider whose `auto` removes the sandbox, and no other', () => {
    const named = SUPPORTED_PROVIDERS.filter((provider) =>
      new RegExp(provider, 'i').test(YOLO_MEANS_FOR_AGENTS_IT_STARTS),
    )
    const sandboxComesOff = SUPPORTED_PROVIDERS.filter((provider) =>
      whatAutoTakesOff(provider).includes('the-sandbox-around-an-act'),
    )
    expect(named).toEqual(sandboxComesOff)
    expect(sandboxComesOff.length).toBeGreaterThan(0)
  })

  it('⛔ it says the half the PO said was missing — the TREE — and does not repeat the half that ships', () => {
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).toMatch(/Agents this conversation starts/)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).toMatch(/run in this mode too/)
    expect(YOLO_MEANS).toContain('--dangerously-skip-permissions')
    expect(YOLO_MEANS).not.toMatch(/Agents this conversation/)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS.split('\n').filter(Boolean)).toHaveLength(1)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS.length).toBeLessThan(160)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).not.toMatch(/unsafe|danger|careful|be aware|warning/i)
  })
})

const WORK = '/tmp/499-work'

function aParent(provider: Provider, approvalMode: ApprovalMode): GivingConversation {
  return { sessionId: 'sess_parent', profileId: 'pm', provider, cwd: WORK, approvalMode }
}

function asThe(giver: GivingConversation): CallerIdentity {
  return { ownerId: agentCallerId(giver.sessionId) }
}

const A_GIVE = newConversationGive('worker', 'x', 'x')

function startOf(out: GiveAdmission): { provider: Provider; approvalMode: ApprovalMode } | null {
  if (!out.ok) return null
  if (out.goes.to !== 'a-new-conversation') throw new Error('nothing was found, so it must start')
  return { provider: out.goes.start.provider, approvalMode: out.goes.start.approvalMode }
}

describe('A conversation started by a give inherits the giver’s approval mode', () => {
  it('works for every combination of giver provider, child provider and mode', () => {
    for (const parentProvider of SUPPORTED_PROVIDERS) {
      for (const mode of MODES) {
        for (const childProvider of SUPPORTED_PROVIDERS) {
          const parent = aParent(parentProvider, mode)
          const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, childProvider))
          expect(startOf(out), `${parentProvider}/${mode} → ${childProvider}`).toEqual({
            provider: childProvider,
            approvalMode: mode,
          })
        }
      }
    }
  })

  it('publishes no spawn-policy rail for the inherited mode', () => {
    for (const tree of ['apps/desktop/src', 'packages/runtime/src', 'packages/shared/src']) {
      const found = filesUnder(join(REPO, tree)).filter((file) => {
        const code = withoutProse(readFileSync(file, 'utf8'))
        return code.includes('spawn-must-prompt') || code.includes('wider-than-its-parent')
      })
      expect(found, tree).toEqual([])
    }
  })
})

function withoutProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function filesUnder(root: string): string[] {
  if (statSync(root).isFile()) return [root]
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((name) => join(root, name))
    .filter((path) => {
      if (!statSync(path).isFile()) return false
      if (path.includes('node_modules') || path.includes('/dist/')) return false
      return /\.(ts|vue|mjs|js|md)$/.test(path)
    })
}
