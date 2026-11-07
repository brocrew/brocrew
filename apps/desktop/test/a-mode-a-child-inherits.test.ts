import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import {
  capabilitiesFor,
  PROTECTIONS,
  SUPPORTED_PROVIDERS,
  whatTheChildWouldLack,
  WHAT_STANDS_PAST_ITS_FOLDER,
  type ApprovalMode,
  type ApprovalPosture,
  type Protection,
} from '@brobot2/runtime'
import {
  admitGive,
  describeRail,
  permanenceOf,
  remedyOf,
  retryableOf,
  SPAWN_RAILS,
  type GiveAdmission,
  type GiveFacts,
  type GivingConversation,
} from '../src/main/runtime/spawn-rails'
import { DEFAULT_CAPABILITIES } from '../src/main/db/session-store'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { SPAWN_RAIL_MEANS } from '../src/shared/capabilities'
import { YOLO_MEANS, YOLO_MEANS_FOR_AGENTS_IT_STARTS } from '../src/renderer/src/lib/approval-mode'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const RUNTIME = join(REPO, 'packages/runtime/src')

const MODES: readonly ApprovalMode[] = ['ask', 'auto']

describe('§1 · what a posture keeps past its folder, and never wider as any against none', () => {
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

  it('⛔ every (parent, child) pair, and the verdict is any against none and nothing else', () => {
    const postures: ApprovalPosture[] = SUPPORTED_PROVIDERS.flatMap((provider) =>
      MODES.map((approvalMode) => ({ provider, approvalMode })),
    )
    expect(postures).toHaveLength(4)
    let refused = 0
    for (const parent of postures) {
      for (const child of postures) {
        const parentKeeps = keptBy(parent)
        const expected =
          keptBy(child).length === 0 ? PROTECTIONS.filter((one) => parentKeeps.includes(one)) : []
        expect(
          whatTheChildWouldLack(child, parent),
          `${label(child)} under ${label(parent)}`,
        ).toEqual(expected)
        if (expected.length > 0) refused += 1
      }
    }
    expect(refused).toBe(4)
  })

  it('🔴 THE DIVERGENCE · the removal reading and the reach reading disagree on exactly one pair, and it is F050`s', () => {
    const claudeAuto: ApprovalPosture = { provider: 'claude', approvalMode: 'auto' }
    const codexAuto: ApprovalPosture = { provider: 'codex', approvalMode: 'auto' }

    expect(claudeAuto.approvalMode).toBe(codexAuto.approvalMode)
    expect(whatTheRemovalReadingRefused(codexAuto, claudeAuto)).toEqual([
      'the-sandbox-around-an-act',
    ])
    expect(whatTheChildWouldLack(codexAuto, claudeAuto)).toEqual([])

    expect(whatTheChildWouldLack(claudeAuto, codexAuto)).toEqual([])

    const claudeAsk: ApprovalPosture = { provider: 'claude', approvalMode: 'ask' }
    expect(whatTheChildWouldLack(codexAuto, claudeAsk)).toEqual(['the-card-before-an-act'])

    const postures: ApprovalPosture[] = SUPPORTED_PROVIDERS.flatMap((provider) =>
      MODES.map((approvalMode) => ({ provider, approvalMode })),
    )
    const parted: string[] = []
    for (const parent of postures) {
      for (const child of postures) {
        const removal = whatTheRemovalReadingRefused(child, parent).length > 0
        const reach = whatTheChildWouldLack(child, parent).length > 0
        if (removal !== reach) parted.push(`${label(child)} under ${label(parent)}`)
        expect(reach, `${label(child)} under ${label(parent)}`).toBe(
          parent.approvalMode === 'ask' && child.approvalMode === 'auto',
        )
      }
    }
    expect(parted).toEqual(['codex/auto under claude/auto'])
  })
})

function label(posture: ApprovalPosture): string {
  return `${posture.provider}/${posture.approvalMode}`
}

function keptBy(posture: ApprovalPosture): readonly Protection[] {
  return WHAT_STANDS_PAST_ITS_FOLDER[posture.provider][posture.approvalMode]
}

function whatAutoTakesOff(provider: Provider): Protection[] {
  const left = WHAT_STANDS_PAST_ITS_FOLDER[provider].auto
  return WHAT_STANDS_PAST_ITS_FOLDER[provider].ask.filter((one) => !left.includes(one))
}

function whatTheRemovalReadingRefused(
  child: ApprovalPosture,
  parent: ApprovalPosture,
): Protection[] {
  const removes = ({ provider, approvalMode }: ApprovalPosture): Protection[] =>
    approvalMode === 'auto' ? whatAutoTakesOff(provider) : []
  const kept = removes(parent)
  return removes(child).filter((one) => !kept.includes(one))
}

describe('§2 · the table says what the adapters DO, and each half is bound differently', () => {
  it('🔴 the CODEX row is bound to `APPROVAL_PROFILES` BY VALUE — in the runtime project', () => {
    const bound = readFileSync(
      join(REPO, 'packages/runtime/test/a-mode-a-child-inherits.test.ts'),
      'utf8',
    )
    expect(bound).toContain("import { APPROVAL_PROFILES } from '../src/codex/codex-runtime'")
    expect(bound).toContain('WHAT_STANDS_PAST_ITS_FOLDER.codex')
    expect(bound).toContain("'danger-full-access'")
    expect(bound).toContain('the-sandbox-around-an-act')
    expect(bound).toContain('!==')
  })

  it('⛔ the CLAUDE row is a NEGATIVE, and this is the search shape behind it', () => {
    const claude = readFileSync(join(RUNTIME, 'claude/claude-runtime.ts'), 'utf8')
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

    for (const file of ['claude/claude-runtime.ts', 'claude/claude-child.ts']) {
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

  it('the current conversation shows its mode choice immediately while it is pending', () => {
    const controls = readFileSync(
      join(HERE, '../src/renderer/src/components/CardApproval.vue'),
      'utf8',
    )
    expect(controls).toContain('data-cy="card-approval"')
    expect(controls).toContain('role="switch"')
    expect(controls).toContain(
      ':checked="(props.approval.pending ?? props.approval.mode) === \'auto\'"',
    )
  })
})

const WORK = '/tmp/499-work'

function factsWith(giver: GivingConversation, childProvider: Provider | null): GiveFacts {
  return {
    giver: () => giver,
    held: () => [{ piece: 'work_root', label: 'W1', root: true, giver: null, received: true }],
    drivenByTheTurn: () => null,
    isAHelper: () => false,
    mayGiveWork: () => null,
    depthOf: () => 0,
    capabilitiesOf: () => DEFAULT_CAPABILITIES,
    helperAs: () => null,
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    mayCreateAgents: () => null,
    itsProvider: () =>
      childProvider === null
        ? { provider: null, from: 'nothing-yet' }
        : { provider: childProvider, from: 'saved' },
    theNamedModelsProvider: () => null,
    modelChoiceOf: () => null,
    checkFolder: (path) => ({ ok: true, path }),
  }
}

function aParent(provider: Provider, approvalMode: ApprovalMode): GivingConversation {
  return { sessionId: 'sess_parent', profileId: 'pm', provider, cwd: WORK, approvalMode }
}

function asThe(giver: GivingConversation): CallerIdentity {
  return { ownerId: agentCallerId(giver.sessionId) }
}

const A_GIVE = {
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'worker',
  title: 'x',
  brief: 'x',
} as const

function startOf(out: GiveAdmission): { provider: Provider; approvalMode: ApprovalMode } | null {
  if (!out.ok) return null
  if (out.goes.to !== 'a-new-conversation') throw new Error('nothing was found, so it must start')
  return { provider: out.goes.start.provider, approvalMode: out.goes.start.approvalMode }
}

describe('§5 · the door — where a started conversation`s mode is decided, and what the refusal says', () => {
  it('🔴 every (giver, child provider) pair through the REAL door, and it agrees with the derivation', () => {
    let admitted = 0
    for (const parentProvider of SUPPORTED_PROVIDERS) {
      for (const parentMode of MODES) {
        for (const childProvider of SUPPORTED_PROVIDERS) {
          const parent = aParent(parentProvider, parentMode)
          const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, childProvider))
          const shouldPass =
            whatTheChildWouldLack(
              { provider: childProvider, approvalMode: parentMode },
              { provider: parentProvider, approvalMode: parentMode },
            ).length === 0
          const where = `${parentProvider}/${parentMode} → ${childProvider}`
          expect(out.ok, where).toBe(shouldPass)
          if (!out.ok) expect(out.refusal.rail, where).toBe('wider-than-its-parent')
          else {
            admitted += 1
            expect(startOf(out), where).toEqual({
              provider: childProvider,
              approvalMode: parentMode,
            })
          }
        }
      }
    }
    expect(admitted).toBe(8)
  })

  it('⛔ the mode INHERITS — the half `366` refused and HO-036 restored', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const mode of MODES) {
        const parent = aParent(provider, mode)
        const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, provider))
        if (!out.ok) throw new Error(`${provider}/${mode} inherited and was refused`)
        expect(startOf(out)?.approvalMode, `${provider}/${mode}`).toBe(mode)
      }
    }
  })

  it('🔴 a lax parent on ONE provider hands its word to a child on the OTHER — F050, given', () => {
    const parent = aParent('claude', 'auto')
    const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, 'codex'))
    if (!out.ok)
      throw new Error(`F050: a Claude auto giver's Codex helper was refused: ${out.refusal.rail}`)
    expect(startOf(out)).toEqual({ provider: 'codex', approvalMode: 'auto' })
    const codexParent = aParent('codex', 'auto')
    const back = admitGive(A_GIVE, asThe(codexParent), factsWith(codexParent, 'claude'))
    if (!back.ok) throw new Error('a cross-provider auto child was refused')
    expect(startOf(back)).toEqual({ provider: 'claude', approvalMode: 'auto' })
    for (const childProvider of SUPPORTED_PROVIDERS) {
      expect(
        whatTheChildWouldLack(
          { provider: childProvider, approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'ask' },
        ),
        childProvider,
      ).toEqual(['the-card-before-an-act'])
    }
  })

  it('⚠️ the rail`s policy facts, and the one arm where the permanence overstates', () => {
    expect(SPAWN_RAILS).toContain('wider-than-its-parent')
    expect(permanenceOf('wider-than-its-parent')).toBe('until-a-person-changes-it')
    expect(retryableOf('wider-than-its-parent')).toBe(false)
    expect(remedyOf('wider-than-its-parent')).toBeNull()
    expect(describeRail('wider-than-its-parent')).toContain(
      'Do this work here, or ask a person whether to change your approval mode',
    )
    expect(describeRail('wider-than-its-parent')).not.toMatch(/provider/)
    const said = SPAWN_RAILS.map((rail) => describeRail(rail))
    expect(new Set(said).size).toBe(SPAWN_RAILS.length)
  })

  it('⛔ every protection has a clause a caller can read — none renders as a raw code', () => {
    for (const protection of PROTECTIONS) {
      const child: ApprovalPosture = { provider: 'claude', approvalMode: 'auto' }
      const parent: ApprovalPosture = { provider: 'codex', approvalMode: 'ask' }
      expect(whatTheChildWouldLack(child, parent)).toContain(protection)
    }
    const sentence = describeRail('wider-than-its-parent', {
      asked: 'auto',
      spawnerRunsAs: 'ask',
      wouldLack: [...PROTECTIONS],
    })
    for (const protection of PROTECTIONS) {
      expect(sentence, protection).not.toContain(protection)
    }
    expect(sentence).toContain('the card before you act')
    expect(sentence).toContain('the sandbox around what you run')
    expect(sentence).toContain('“ask”')
    expect(sentence).toContain('“auto”')
  })
})

describe('§6 · `spawn-must-prompt` is retired, and the sentences that described it moved', () => {
  it('⛔ the word is gone from the CODE, and survives only where a docblock records the withdrawal', () => {
    for (const tree of ['apps/desktop/src', 'packages/runtime/src', 'packages/shared/src']) {
      const found = filesUnder(join(REPO, tree)).filter((file) =>
        withoutProse(readFileSync(file, 'utf8')).includes('spawn-must-prompt'),
      )
      expect(found, tree).toEqual([])
    }
    expect(
      withoutProse(
        readFileSync(join(REPO, 'apps/desktop/src/main/runtime/spawn-rails.ts'), 'utf8'),
      ),
    ).toContain("'wider-than-its-parent'")
    expect((SPAWN_RAILS as readonly string[]).includes('spawn-must-prompt')).toBe(false)
    const guide = readFileSync(join(REPO, 'docs/development.md'), 'utf8')
    expect(guide).not.toContain('spawn-must-prompt')
    expect(guide).toContain('never wider')
  })

  it('🔴 the person-facing sentence states the rule that is in force, and not the withdrawn one', () => {
    expect(SPAWN_RAIL_MEANS).toContain('runs the way that agent does')
    expect(SPAWN_RAIL_MEANS).toContain('can never be given more')
    expect(SPAWN_RAIL_MEANS).not.toMatch(/never open without prompts/)
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
