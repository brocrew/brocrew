import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { capabilitiesFor } from '@brobot2/runtime'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import {
  ALL_VERBS,
  SEND_REFUSALS,
  SEND_VERBS,
  SIGN_IN_SUPERSEDED_BLOCK,
  VERB_REQUIRES,
  WIRE_REFUSALS,
} from '../src/renderer/src/lib/send-refusals'


const here = dirname(fileURLToPath(import.meta.url))
const HOST = join(here, '../src/main/runtime/runtime-host.ts')
const IPC = join(here, '../src/shared/runtime-ipc.ts')
const PANE = join(here, '../src/renderer/src/components/ConversationPane.vue')
const SCREEN = join(here, '../src/renderer/src/components/RuntimeScreen.vue')
const STORE = join(here, '../src/renderer/src/lib/session-store.ts')

function codeOf(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/')) continue
          at += 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = true
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}

function methodBody(source: string, signature: string): string {
  const from = source.indexOf(signature)
  if (from === -1) return ''
  const to = source.indexOf('\n  }', from)
  if (to === -1) return ''
  return source.slice(from, to)
}

function throws(body: string): number {
  return body.match(/\bthrow\b/g)?.length ?? 0
}

const SIGNATURES = {
  send: '\n  private async sendAs(',
  requireToMessage: '\n  private requireToMessage(',
  sessionFor: '\n  private sessionFor(',
  withinMessagingReach: '\n  withinMessagingReach(',
  assertMayMessage: '\n  private assertMayMessage(',
  assertMayControl: '\n  private assertMayControl(',
  assertMayReach: '\n  private assertMayReach(',
  assertCanTakeTurn: '\n  private async assertCanTakeTurn(',
  whatTheseWordsAre: '\n  private async whatTheseWordsAre(',
  handToProvider: '\n  private handToProvider(',
  assertAcceptsMessages: '\n  private assertAcceptsMessages(',
  assertSignInCurrent: '\n  private async assertSignInCurrent(',
  deliverWhenItRuns: '\n  private deliverWhenItRuns<T>(',
  refuseBeforeAStart: '\n  private async refuseBeforeAStart(',
} as const

type Method = keyof typeof SIGNATURES

const REPEATS_A_ROW: Partial<Record<Method, readonly { line: string; row: string }[]>> = {
  handToProvider: [
    {
      line: 'if (handed.length > 0) throw new ACommandTakesNoAttachments(command.word, command.listed)',
      row: 'a-command-takes-no-attachments',
    },
  ],
  refuseBeforeAStart: [
    {
      line: 'if (!this.withinMessagingReach(sessionId, by, me)) {\n        throw new Error(`unknown session: ${sessionId}`)',
      row: 'unknown-session',
    },
    {
      line: '} else if (row === null || this.startable(sessionId) === null) {\n      throw new Error(`unknown session: ${sessionId}`)',
      row: 'unknown-session',
    },
    {
      line: 'throw new Error(`unknown session: ${sessionId}`)\n    }\n    if (theSurfaceAsking(by) === null) return',
      row: 'unknown-session',
    },
    {
      line: 'if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)',
      row: 'nothing-to-send',
    },
    {
      line: "if ('refusal' in handed) throw new Error(handed.refusal)",
      row: 'attachment-vanished',
    },
  ],
}


const PASSED_ON: Partial<Record<Method, readonly string[]>> = {
  send: [
    "if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof TurnInProgress)) throw error",
    "'after-a-lost-race',\n        )\n        return\n      }\n      throw error\n    }",
    'if (this.aCallersWordsNoLongerGoStraightIn(sessionId, by)) throw new TurnInProgress()',
  ],
  deliverWhenItRuns: [
    'throw waker === null ? error : new AStartThatDidNotHappen(error)',
    'throw refused',
  ],
  handToProvider: [
    'session.itsTurnIs = kept\n        throw error',
    'session.itsTurnIs = kept\n      throw error',
  ],
}

const host = codeOf(readFileSync(HOST, 'utf8'))
const bodies: Record<Method, string> = {
  send: methodBody(host, SIGNATURES.send),
  requireToMessage: methodBody(host, SIGNATURES.requireToMessage),
  sessionFor: methodBody(host, SIGNATURES.sessionFor),
  withinMessagingReach: methodBody(host, SIGNATURES.withinMessagingReach),
  assertMayMessage: methodBody(host, SIGNATURES.assertMayMessage),
  assertMayControl: methodBody(host, SIGNATURES.assertMayControl),
  assertCanTakeTurn: methodBody(host, SIGNATURES.assertCanTakeTurn),
  whatTheseWordsAre: methodBody(host, SIGNATURES.whatTheseWordsAre),
  assertAcceptsMessages: methodBody(host, SIGNATURES.assertAcceptsMessages),
  assertSignInCurrent: methodBody(host, SIGNATURES.assertSignInCurrent),
  assertMayReach: methodBody(host, SIGNATURES.assertMayReach),
  handToProvider: methodBody(host, SIGNATURES.handToProvider),
  deliverWhenItRuns: methodBody(host, SIGNATURES.deliverWhenItRuns),
  refuseBeforeAStart: methodBody(host, SIGNATURES.refuseBeforeAStart),
}
const chain = `${bodies.assertCanTakeTurn}\n${bodies.whatTheseWordsAre}`

describe('the census can see what it is censusing', () => {
  it('⚑ every method body was really found, and the stripper did not empty them', () => {
    for (const [name, body] of Object.entries(bodies)) {
      expect(body.length, `${name} was not found in runtime-host.ts`).toBeGreaterThan(80)
    }
    expect(chain.length, 'assertCanTakeTurn was not found').toBeGreaterThan(40)
    expect(bodies.sessionFor).toContain('unknown session:')
    expect(bodies.assertSignInCurrent).toContain('checkSignIn')
  })

  it('⚑ the stripper removes prose that says "throw", and keeps statements that do', () => {
    expect(readFileSync(HOST, 'utf8')).toContain('Publish before throwing')
    expect(throws(bodies.assertSignInCurrent)).toBe(1)
    expect(throws(`${bodies.assertSignInCurrent}\n    throw new Error('extra')`)).toBe(2)
  })
})

describe('219 §2 · the table names every refusal on the send path', () => {
  it('🔴 every throw in the chain is named by a row, and every row names a throw', () => {
    for (const [name, body] of Object.entries(bodies)) {
      const rows = SEND_REFUSALS.filter((refusal) => refusal.thrownBy === name)
      const passedOn = PASSED_ON[name as Method] ?? []
      const repeats = REPEATS_A_ROW[name as Method] ?? []
      expect(
        throws(body),
        `${name} throws a number of times the table does not account for — a refusal was added ` +
          'to the send path without deciding whether this window can know about it first',
      ).toBe(rows.length + passedOn.length + repeats.length)
      for (const line of passedOn) {
        expect(body, `${name} no longer passes the adapter's failure on as named`).toContain(line)
      }
      for (const repeat of repeats) {
        expect(body, `${name} no longer repeats ${repeat.row} as named`).toContain(repeat.line)
        expect(SEND_REFUSALS.map((row) => row.id)).toContain(repeat.row)
      }
      for (const row of rows) {
        expect(body, `${row.id} does not match anything in ${name}`).toContain(row.hostSays)
      }
    }
  })

  it('🔴 the chain is the one the table assumes — every method, reached in one order', () => {
    expect(bodies.send).toContain('this.requireToMessage(')
    expect(bodies.send).toContain('this.assertCanTakeTurn(')
    expect(bodies.send).toContain('recheckHandedPaths(')
    const sendCode = bodies.send.replace(/\s+/g, ' ')
    expect(sendCode).toContain(
      "if ( how.onAStop === 'start-it-again' && !(error instanceof StoppedBeforeSend) && this.itStoppedUnder(session) ) { return this.aDeliveryAStopCaught(sessionId, text, by, attachments, how) }",
    )
    expect(sendCode).toContain(
      "if ( how.onAStop === 'start-it-again' && !(error instanceof TurnInProgress) && !(error instanceof StoppedBeforeSend) && this.itStoppedUnder(session) ) { return this.aDeliveryAStopCaught(sessionId, text, by, attachments, how) }",
    )
    const THE_DOOR = '\n  send(\n    sessionId: string,'
    const door = methodBody(host, THE_DOOR)
    expect(host.split(THE_DOOR).length, 'more than one public `send` door').toBe(2)
    const opens = door.indexOf('): Promise<void> {')
    expect(opens, 'the public send lost its signature').toBeGreaterThan(0)
    const statements = door
      .slice(opens + '): Promise<void> {'.length)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    expect(statements).toEqual([
      'let now: boolean',
      'try {',
      'now = this.takesADeliveryNow(sessionId)',
      'if (now) this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))',
      '} catch (error) {',
      'return Promise.reject(error)',
      '}',
      'const send = (to: string): Promise<void> =>',
      "this.sendAs(to, text, by, attachments, { facts, ifItLosesTheRace: 'hold-it' })",
      'if (now) {',
      'return this.sendAs(sessionId, text, by, attachments, {',
      'facts,',
      "ifItLosesTheRace: 'hold-it',",
      "onAStop: 'start-it-again',",
      '})',
      '}',
      'return this.deliverWhenItRuns(',
      'sessionId,',
      'text,',
      'by,',
      'attachments,',
      'WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,',
      'send,',
      ')',
    ])
    expect(throws(door)).toBe(0)
    const wayIn = bodies.deliverWhenItRuns
    const railsAt = wayIn.indexOf('await this.refuseBeforeAStart(to, text, by, attachments, says)')
    expect(railsAt, 'the way in stopped asking the rails').toBeGreaterThan(-1)
    expect(railsAt).toBeLessThan(wayIn.indexOf('await this.ensureRunning('))
    const afterTheStart = wayIn.indexOf('return deliver(ran)')
    expect(afterTheStart, 'the way in stopped delivering after the start').toBeGreaterThan(-1)
    expect(wayIn.indexOf('await this.ensureRunning(')).toBeLessThan(afterTheStart)
    const straightIn = wayIn.indexOf('if (this.runsNow(to)) {')
    expect(straightIn, 'the way in lost its running check').toBeGreaterThan(-1)
    expect(wayIn.indexOf('return deliver(to)')).toBeGreaterThan(straightIn)
    expect(wayIn.indexOf('return deliver(to)')).toBeLessThan(railsAt)
    expect(wayIn.split('return deliver(')).toHaveLength(3)
    expect(host).toContain("const WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS: AgentMessageKind = 'note'")
    expect(bodies.refuseBeforeAStart).toContain('this.assertMayMessage(slot, by)')
    expect(chain).toContain('this.assertAcceptsMessages(')
    expect(chain).toContain('this.assertSignInCurrent(')
    expect(bodies.requireToMessage).toContain('this.sessionFor(')
    expect(bodies.assertMayMessage).toContain('this.assertMayControl(')
    expect(bodies.assertMayMessage).toContain('this.withinMessagingReach(slot.id, by)')
    expect(bodies.withinMessagingReach).toContain('reachesWhatItDidNotStart(')
    expect(host).toContain('private assertMayCommand(')
    expect(bodies.send).toContain('this.assertMayReach(')
    expect(bodies.assertMayReach).toContain('sessionSpeakingAs(by)')
    expect(throws(chain), 'assertCanTakeTurn grew a refusal the table does not name').toBe(4)
    expect(bodies.assertCanTakeTurn).toContain('return this.whatTheseWordsAre(session, content)')
    expect(chain).toContain('hasSomethingToSend(')
    for (const refusal of [
      'throw new ACommandTakesNoAttachments(command.word',
      'throw new ACommandTakesNoAttachments(compaction.word',
      'throw new ACompactionTakesNoInstructions(',
    ]) {
      expect(chain.indexOf(refusal), refusal).toBeGreaterThan(-1)
      expect(chain.indexOf('this.assertSignInCurrent('), refusal).toBeLessThan(
        chain.indexOf(refusal),
      )
    }
    expect(chain.indexOf('hasSomethingToSend(')).toBeLessThan(
      chain.indexOf('this.assertAcceptsMessages('),
    )
    const named: string[] = Object.keys(SIGNATURES)
    expect(SEND_REFUSALS.every((row) => named.includes(row.thrownBy))).toBe(true)
  })

  it('⚑ the rows are distinct, and there are twelve of them', () => {
    expect(SEND_REFUSALS).toHaveLength(12)
    expect(new Set(SEND_REFUSALS.map((row) => row.id)).size).toBe(12)
    for (const row of SEND_REFUSALS) {
      expect(row.gate.length, `${row.id} has no gate written down`).toBeGreaterThan(40)
    }
  })
})

describe('219 §2 · the knowable verdicts are true of the code today', () => {
  const row = (id: string) => SEND_REFUSALS.find((each) => each.id === id)!

  it('🔴 `sign-in-superseded` is first-press, and the pane now hands the composer the reason', () => {
    expect(row('sign-in-superseded').knowable).toBe('first-press')
    const pane = readFileSync(PANE, 'utf8')
    expect(pane, 'ConversationPane stopped passing `blocked`').toContain(':blocked="sendBlocked"')
    expect(pane).toContain('SIGN_IN_SUPERSEDED_BLOCK')
  })

  it('🔴 `conversation-over` and `still-starting` are before-the-press, and the code still says so', () => {
    expect(row('conversation-over').knowable).toBe('before')
    expect(row('still-starting').knowable).toBe('before')
    const pane = readFileSync(PANE, 'utf8')
    expect(pane).toContain("if (props.record.phase === 'recorded') return 'idle'")
    expect(pane).not.toContain("return 'ended'")
    expect(pane).toContain('const cannot = props.record.meta?.cannotTakeAMessage ?? null')
    expect(pane).toContain('if (cannot !== null) reasons.push({ words: cannot })')
    expect(readFileSync(SCREEN, 'utf8')).toContain("surface === 'conversation' && active?.meta")
  })

  it('🔴 `a-command-takes-no-attachments` is BEFORE the press — and the gate it names exists, in one home', () => {
    expect(row('a-command-takes-no-attachments').knowable).toBe('before')
    const transcript = readFileSync(join(here, '../src/renderer/src/lib/transcript.ts'), 'utf8')
    expect(transcript).toContain("case 'provider_commands': {")
    const pane = readFileSync(PANE, 'utf8')
    const from = pane.indexOf('const sendBlocked = computed<SendBlock[]>(() => {')
    expect(from, 'sendBlocked is gone').toBeGreaterThan(-1)
    const body = pane.slice(from, pane.indexOf('\n})', from))
    expect(body).toContain('aCommandInTheBox(props.draft, control.value.commands)')
    expect(body).toContain('aCommandTakesNoAttachmentsYet(command)')
    expect(body).toContain('props.handing.staged.length > 0')
    expect(pane).toContain(':blocked="sendBlocked"')
    const renderer = join(here, '../src/renderer/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name)
        if (entry.isDirectory()) walk(at)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(at)
      }
    }
    walk(renderer)
    expect(files.length, 'the renderer walk found nothing').toBeGreaterThan(50)
    const saying = files
      .filter((file) => readFileSync(file, 'utf8').includes('takes no attachments'))
      .map((file) => file.slice(renderer.length + 1).replaceAll('\\', '/'))
      .sort()
    expect(saying).toEqual(['lib/a-command-with-files.ts', 'lib/send-refusals.ts'])
  })

  it('⚠️ 713 · `R59`’s two refusals are NEVER knowable — the fact reaches the window only as words', () => {
    expect(row('a-compaction-takes-no-attachments').knowable).toBe('never')
    expect(row('a-compaction-takes-no-instructions').knowable).toBe('never')
    const codex = capabilitiesFor('codex').requestCompaction
    expect(codex.state === 'available' ? codex.note : '').toContain('no instructions')
    expect(Object.keys(codex).sort()).toEqual(['note', 'state'])
    const renderer = join(here, '../src/renderer/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name)
        if (entry.isDirectory()) walk(at)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(at)
      }
    }
    walk(renderer)
    expect(files.length, 'the renderer walk found nothing').toBeGreaterThan(50)
    const GATE_SHAPES = [
      /compacts without instructions/,
      /ACompactionTakesNoInstructions|aCompactionTakesNoInstructions/,
      /aPersonsCompaction/,
      /\bcompactsOnRequest\b|handle\.compact\b/,
    ]
    for (const file of files) {
      if (file.endsWith('send-refusals.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const shape of GATE_SHAPES) expect(source, `${file} matches ${shape}`).not.toMatch(shape)
    }
    const main =
      readFileSync(HOST, 'utf8') +
      readFileSync(join(here, '../src/main/runtime/a-command-goes-as-typed.ts'), 'utf8')
    for (const shape of GATE_SHAPES) expect(main, `${shape} finds nothing in main`).toMatch(shape)
  })

  it('🔴 `still-closing` is knowable BEFORE the press, and not from the liveness channel', () => {
    expect(row('still-closing').knowable).toBe('before')
    const ipc = readFileSync(IPC, 'utf8')
    const from = ipc.indexOf('\nexport interface SessionLiveness {')
    const body = from === -1 ? '' : ipc.slice(from, ipc.indexOf('\n}', from))
    expect(
      body.length,
      'SessionLiveness was not found — this assertion is about nothing',
    ).toBeGreaterThan(400)
    expect(body).not.toMatch(/^\s*closing\??:/m)
    expect(body).toMatch(/^\s*signInSuperseded\??:/m)
    expect(readFileSync(STORE, 'utf8')).toContain("asked!.phase = 'closing'")
    expect(readFileSync(PANE, 'utf8')).toContain(
      "if (props.record.phase === 'closing') reasons.push({ words: CLOSING_BLOCK })",
    )
  })
})

describe('219 §1 · the sentence a person reads', () => {
  it('🔴 is not the host’s exception text, and not the bar’s', () => {
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('cannot send:')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('Nothing has been sent.')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('your machine has moved on')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('A renewal counts')
  })

  it('🔴 says why the control is dark AND names the remedy — 118’s rule, 106’s rule', () => {
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/no message can go out/i)
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/reopen/i)
    expect(SIGN_IN_SUPERSEDED_BLOCK.length).toBeLessThan(140)
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toMatch(/@|signed in as|account/i)
  })
})

describe('221 §1b · the wire, censused against the schema itself', () => {
  const SCHEMA = join(here, '../src/main/runtime/ipc.ts')

  function sendDeclarations(): string {
    const code = codeOf(readFileSync(SCHEMA, 'utf8'))
    const between = (from: string, to: string): string => {
      const at = code.indexOf(from)
      const end = code.indexOf(to, at)
      expect(at, `${from} was not found in ipc.ts`).toBeGreaterThan(-1)
      expect(end, `${to} was not found after ${from}`).toBeGreaterThan(at)
      return code.slice(at, end)
    }
    return [
      between('const sessionId =', 'const requestId'),
      between('const launchKey =', 'const attachments ='),
      between('const attachments =', 'function sendShaped'),
      between('function sendShaped', 'export const runtimeCommandSchema'),
    ].join('\n')
  }

  it('⚑ one row per constraint — a rule cannot be added without being classified', () => {
    const declarations = sendDeclarations()
    expect(declarations.length).toBeGreaterThan(400)
    const rules = declarations.match(/\.(?:min|max|refine)\(|z\.(?:enum|boolean)\(/g) ?? []
    expect(
      rules.length,
      'a rule was added to or removed from the send commands — give it a row in WIRE_REFUSALS',
    ).toBe(WIRE_REFUSALS.length)
    expect(WIRE_REFUSALS).toHaveLength(14)
    for (const row of WIRE_REFUSALS) {
      expect(row.field.length, 'a row with no field').toBeGreaterThan(2)
      expect(
        row.composerHolds.length,
        `\`${row.field}\` is classified with no reason`,
      ).toBeGreaterThan(60)
    }
  })

  it('🔴 every probe is REALLY refused, by every verb its row claims', () => {
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      for (const kind of row.verbs) {
        const command = { kind, sessionId: 'sess_1', ...VERB_REQUIRES[kind], ...row.probe }
        expect(
          runtimeCommandSchema.safeParse(command).success,
          `\`${row.field} ${row.rule}\` is in WIRE_REFUSALS and \`${kind}\` does not enforce it`,
        ).toBe(false)
      }
    }
  })

  it('⚑ an exclusion is a fact about the schema, and the one that is not is named', () => {
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      if (row.verbs.includes('endPlanMode') || !row.field.startsWith('attachments')) continue
      expect(
        runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', ...row.probe })
          .success,
        `\`${row.field}\` excludes endPlanMode, but endPlanMode refuses its probe — the row is wrong`,
      ).toBe(true)
    }
    expect(WIRE_REFUSALS.filter((row) => row.field === 'sessionId')).toHaveLength(2)
    for (const row of WIRE_REFUSALS.filter((row) => row.field === 'sessionId')) {
      expect(row.verbs, 'a shared declaration is censused on every verb that uses it').toEqual(
        ALL_VERBS,
      )
    }
    expect(
      WIRE_REFUSALS.filter((row) => row.verbs.includes('endPlanMode')).map((row) => row.field),
      'the fourth verb is censused by the two shared rules and by its own text rule, and no other',
    ).toEqual(['sessionId', 'sessionId', 'text (endPlanMode)'])
    expect(new Set(WIRE_REFUSALS.flatMap((row) => row.verbs))).toEqual(new Set(ALL_VERBS))
  })

  it('⚑ …and the legal payloads those probes are variations of are ACCEPTED — the paired positive', () => {
    const attachments = [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }]
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: 'go ahead' })
        .success,
    ).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1' }).success,
      'leaving plan mode with no message is the 085 LEAVE and must still be a legal command',
    ).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: '' })
        .success,
    ).toBe(false)
    for (const kind of SEND_VERBS) {
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'hello' }).success,
      ).toBe(true)
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'here', attachments })
          .success,
      ).toBe(true)
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: '', attachments })
          .success,
        'an attachment-only message is refused by the wire again — this is 220’s adoption blocker',
      ).toBe(true)
    }
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: 'how is it going?',
      }).success,
    ).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'sendToChild', sessionId: 'sess_1', text: 'hello' })
        .success,
      'a message to no child in particular is not a command this wire accepts',
    ).toBe(false)
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: '   ',
      }).success,
    ).toBe(false)
  })

  it('⛔ nothing a composer can build is refused — and that is the CLAIM, not an empty table', () => {
    expect(WIRE_REFUSALS.filter((row) => row.verdict === 'reachable')).toEqual([])
    expect(WIRE_REFUSALS.every((row) => row.verdict === 'composer-cannot')).toBe(true)
    expect(SEND_REFUSALS.map((row) => row.id)).not.toContain('attachment-only')
  })
})
