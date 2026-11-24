import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle } from '../src/index'
import { CodexRuntime } from '../src/codex'
import {
  completedTurn,
  turnCompletedNotification,
  turnStartResponse,
} from './fixtures/codex-protocol'
import { FakeTransport, adopt, collect, okThread, startCodex } from './helpers/fake-codex-transport'

describe('plan mode reaches the Codex wire as collaborationMode (057)', () => {
  /** Start a session, run one turn, and hand back what `turn/start` was given. */
  async function turnParams(
    options: Record<string, unknown>,
    handshake: Record<string, unknown> = {},
  ): Promise<{
    params: Record<string, unknown>
    transport: FakeTransport
    handle: SessionHandle
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), ...handshake }))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...options,
    })
    await handle.send('do the thing')
    return { params: sent[0] as Record<string, unknown>, transport, handle }
  }

  it('a planning session sends the exact shape the app-server accepts', async () => {
    // ⚠️ Every field here was measured, not inferred, and each of the first three was a rejection
    // before it was a test: `{mode}` alone → "missing field `settings`"; `settings:{}` → "missing
    // field `model`"; `settings.model: null` → "invalid type: null, expected a string". The probe
    // sent them against a bogus thread id, so params were deserialized and no turn ever ran.
    const { params, handle } = await turnParams({ planMode: true }, { model: 'gpt-5.1-codex' })
    expect(params['collaborationMode']).toEqual({
      mode: 'plan',
      settings: {
        // The SERVER's model, echoed back. Plan mode's settings take precedence over
        // `TurnStartParams.model`, so anything else here would move the session onto another model
        // as a side effect of asking it to plan.
        model: 'gpt-5.1-codex',
        reasoning_effort: null,
        // null means "use the built-in instructions for the selected mode" — measured: the server
        // filled it with 9,156 characters of its own plan-mode prompt. Putting anything of ours
        // there would REPLACE that and turn plan mode off while the setting still said `plan`.
        developer_instructions: null,
      },
    })
    await handle.close()
  })

  it('an ordinary session sends NO collaborationMode at all', async () => {
    // Not `{mode:'default'}`. Sending a mode at all overrides the thread's model, effort AND
    // developer instructions — including the `developerInstructions` a systemHint put there at
    // `thread/start` — so the quiet path has to stay quiet.
    for (const options of [{}, { planMode: false }]) {
      const { params, handle } = await turnParams(options)
      expect(params).not.toHaveProperty('collaborationMode')
      await handle.close()
    }
  })

  it('the effort the session chose survives being asked to plan', async () => {
    // `collaborationMode` takes precedence over `effort`, so leaving `reasoning_effort` null while
    // the turn also carries `effort:'high'` would let the mode's own preset (`medium`, per
    // `collaborationMode/list`) quietly win. Echoing our own value back makes the override a no-op —
    // the same reasoning the sandbox re-pin uses.
    const { params, handle } = await turnParams({ planMode: true, reasoningEffort: 'high' })
    expect(params['effort']).toBe('high')
    expect(params['collaborationMode']).toMatchObject({
      settings: { reasoning_effort: 'high' },
    })
    await handle.close()
  })

  it('…and so does an effort only the SERVER knows about', async () => {
    // Nobody asked, but `config.toml` did: the handshake reports it (082) and that report is what
    // goes back into the mode's settings. Without this, a planning turn silently demotes a session
    // the user configured elsewhere.
    const { params, handle } = await turnParams({ planMode: true }, { reasoningEffort: 'ultra' })
    expect(params).not.toHaveProperty('effort') // we still asked for nothing
    expect(params['collaborationMode']).toMatchObject({ settings: { reasoning_effort: 'ultra' } })
    await handle.close()
  })

  it('a RESUMED planning session is still planning', async () => {
    // The thread's `collaborationMode` is sticky server-side, so a resume that dropped the flag
    // would leave the thread planning while the session believed it was not — invisible AND still
    // in force. Re-sending it every turn is what keeps the two in agreement.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planMode: true },
    )
    await handle.send('carry on')
    expect((sent[0] as Record<string, unknown>)['collaborationMode']).toMatchObject({
      mode: 'plan',
    })
    await handle.close()
  })

  it('a plan-mode session with no reported model REFUSES the turn rather than dropping the setting', async () => {
    // The failure this guards is the one the dispatch calls the worst outcome: a toggle that
    // silently does nothing. `settings.model` is a required non-null string, so a session that
    // cannot fill it has to choose between failing loudly and running un-planned while the UI still
    // shows the tick. `ThreadStartResponse.model` is required and validated, so this is a guard
    // against a future that stops reporting it — never a state seen on the wire.
    const transport = new FakeTransport()
    const handshake = okThread('th_1')
    delete handshake['model']
    transport.onRequest('thread/start', () => handshake)
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
    })
    await expect(handle.send('plan this')).rejects.toThrow(/plan-mode turn/)
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(false)
    // ⚠️ …and the REFUSAL does not brick the session (057 review). The first version of this guard
    // sat just after `beginTurn()`, which marks a turn live and emits `working` — so the throw left
    // an open turn nothing was driving, the session sat at `working` forever, and every later send
    // failed with "a turn is in progress". The assertion below is the one that catches that: the
    // second attempt must fail the SAME way as the first, not with a turn-in-progress complaint.
    expect(handle.status()).not.toBe('working')
    await expect(handle.send('plan this')).rejects.toThrow(/plan-mode turn/)
    await handle.close()
  })

  it('the plan document RESTATES the running checklist instead of emptying it (057 review)', async () => {
    // `plan_update` means "here is the complete list" (028), so the document event's `steps: []`
    // would erase an open checklist. The normalizer is pure and cannot see one plan while producing
    // the other, so the handle restates it — the same thing `todoPlan.document()` does on the Claude
    // side. The two plans are not expected to meet on this provider (the server forbids the
    // checklist tool while planning), which is a reason to expect this never to fire, not a reason
    // to leave the erase possible.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [
        { step: 'read hello.js', status: 'completed' },
        { step: 'write the flag', status: 'inProgress' },
      ],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(2))
    const document = events.filter((e) => e.type === 'plan_update').at(-1)
    expect(document).toMatchObject({
      body: '# Plan\n\nDo the thing.',
      steps: [
        { text: 'read hello.js', status: 'done' },
        { text: 'write the flag', status: 'active' },
      ],
    })
    await handle.close()
    await consumer
  })

  it('an EMPTY checklist notification does not wipe what the document would restate (064)', async () => {
    // ⚠️ Found by 067's review, carried into 064. `turn/plan/updated` with an empty `plan` array
    // normalises to `plan_update{steps: []}` with no body and no note — an event that says NOTHING.
    // The renderer already reads it that way (*"an empty checklist appearing out of nowhere claims a
    // plan exists and shows none"*), while `restatePlan` read it as "the checklist is now empty" and
    // wiped its memory. The plan DOCUMENT that followed then went out with `steps: []` at a consumer
    // whose contract is to REPLACE on it — erasing a checklist the reader could still see.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [{ step: 'read hello.js', status: 'inProgress' }],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))

    // The event that says nothing.
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [],
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(2))

    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(3))

    expect(events.filter((e) => e.type === 'plan_update').at(-1)).toMatchObject({
      body: '# Plan\n\nDo the thing.',
      steps: [{ text: 'read hello.js', status: 'active' }],
    })
    await handle.close()
    await consumer
  })

  it('an UNATTENDED planning session still runs unattended — no new consent surface (057, per 056)', async () => {
    // ⚠️ 056's hazard, checked on the other provider: it added a tool name to a set that is consulted
    // ABOVE the auto-approve early return, and nearly shipped a yolo session that stops until a human
    // comes back. Plan mode here goes on `turn/start` and touches no approval path at all — so this
    // asserts what that buys: yolo keeps its profile, the plan rides along with it, and nothing is
    // raised for anyone to answer.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
      planMode: true,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('plan and go')
    const params = sent[0] as Record<string, unknown>
    expect(params['approvalPolicy'], 'yolo is not softened by planning').toBe('never')
    expect(params['sandboxPolicy']).toEqual({ type: 'dangerFullAccess' })
    expect(params['collaborationMode']).toMatchObject({ mode: 'plan' })
    // The plan document arrives, and asks nothing of anybody. Scoped the way a conformant
    // app-server scopes it (060/061): an unscoped notification is dropped, and working around that
    // here would be testing a wire nobody sends.
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    await consumer
  })
})

describe('the go-ahead that ends Codex plan mode (060)', () => {
  /**
   * A planning session plus every `turn/start` it sends, so a mode change is visible turn by turn.
   *
   * `turn(text)` sends AND terminalizes, because one live turn per session is a `SessionMachine`
   * invariant (008) and this suite's whole subject is what the SECOND turn carries.
   */
  async function planning(options: Record<string, unknown> = {}) {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
      ...options,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    async function turn(text: string): Promise<void> {
      const n = sent.length + 1
      await handle.send(text)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(`tn_${n}`)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    }
    return { transport, handle, sent, events, consumer, turn }
  }

  it('⚠️ leaving without approving reaches the wire as the SAME transition (085)', async () => {
    // Plan-off and the go-ahead use the same wire transition. Assert that through the bytes
    // so the person can enter and leave planning mode without a second transition vocabulary.
    //
    // The app-level difference between approving and leaving is whether a message rides along.
    // Below, NOTHING is sent after `setPlanMode(false)` except the user's own next words, and the
    // turn that carries them is byte-identical in `collaborationMode` to the one the go-ahead
    // produces. If these two ever diverge, "leaving" has quietly become a second transition.
    const { handle, sent, consumer, turn } = await planning()
    await turn('plan it')
    expect(
      (sent[0]?.['collaborationMode'] as { mode: string }).mode,
      'positive: it really was planning',
    ).toBe('plan')

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead, 'the bar goes on the REQUEST, not on the next turn').toBe(false)
    // The user's own prompt — no approval text, nothing this app composed on their behalf.
    await turn('actually, what does the config file look like?')

    const second = sent[1] as Record<string, unknown>
    expect((second['collaborationMode'] as { mode: string }).mode).toBe('default')
    expect(second['input'] ?? second['text'] ?? JSON.stringify(second)).not.toContain('Go ahead')

    await handle.close()
    await consumer
  })

  it('a planning turn carries the INTENDED effort and model, not the last reported ones (076)', async () => {
    // ⚠️ **The trap this closes is silent by construction, and only on planning sessions.**
    // `collaborationMode` is documented to take precedence over `model` and `reasoning_effort` on
    // the same request. Until 076 this adapter filled it with what the SERVER last reported —
    // correct while nothing could change them mid-conversation, and a silent no-op the moment
    // `setReasoningEffort` existed: the user's new effort would go out in `effort` and be
    // overridden, on the same message, by the old one.
    //
    // So the failure mode was never an error. It was the effort control doing nothing at all, on
    // exactly the conversations whose settings someone is watching.
    const { handle, sent, consumer, turn } = await planning()
    await turn('plan it')
    expect((sent[0]?.['collaborationMode'] as { settings: { model: string } }).settings.model).toBe(
      'gpt-5.6-sol',
    )

    await handle.setReasoningEffort('high')
    await handle.setModel('gpt-5.6-terra')
    await turn('plan it differently')
    const second = sent[1] as Record<string, unknown>
    const mode = second['collaborationMode'] as {
      settings: { model: string; reasoning_effort: string | null }
    }
    expect(second['effort'], 'the turn asks for it').toBe('high')
    expect(mode.settings.reasoning_effort, 'and the field that OVERRIDES it agrees').toBe('high')
    expect(second['model']).toBe('gpt-5.6-terra')
    expect(mode.settings.model).toBe('gpt-5.6-terra')

    await handle.close()
    await consumer
  })

  it('a session that never planned stays quiet until asked, then asserts a mode (076)', async () => {
    // `never → planning` is the direction 057/060 never had, and the quiet path matters: a session
    // that never planned sends NO `collaborationMode` at all, because sending one replaces the
    // thread's developer instructions.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    const runTurn = async (text: string): Promise<void> => {
      const n = sent.length + 1
      await handle.send(text)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(`tn_${n}`)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    }

    await runTurn('one')
    expect(sent[0]?.['collaborationMode'], 'the quiet path stays quiet').toBeUndefined()
    expect(handle.settings.planMode).toEqual({ effective: false, requested: false })

    await handle.setPlanMode(true)
    expect(handle.settings.planMode, 'queued like every other setting').toEqual({
      effective: false,
      requested: true,
    })
    await runTurn('now plan')
    expect((sent[1]?.['collaborationMode'] as { mode: string }).mode).toBe('plan')
    expect(handle.planNeedsGoAhead).toBe(true)

    // ⚠️ `never → left` must NOT be reachable, which is why this is asserted on a session that HAS
    // planned rather than assumed from the type. `left` means "keep asserting {mode:'default'}", and
    // asserting a mode on a thread that never planned would replace its developer instructions — so
    // a tolerant no-op there is a data-loss bug wearing a shrug.
    await handle.setPlanMode(false)
    await runTurn('go on')
    expect((sent[2]?.['collaborationMode'] as { mode: string }).mode).toBe('default')

    await handle.close()
    await consumer
  })

  it('sends the model on turn/start, which is how a change reaches a running conversation (076)', async () => {
    // Before 076 the model was sent once, at `thread/start` — which is exactly why changing it meant
    // starting a new conversation. `TurnStartParams.model` is documented as an override "for this
    // turn and subsequent turns", the same mechanism the approval profile and the effort ride.
    const { handle, sent, consumer, turn } = await planning({ planMode: false })
    await turn('one')
    expect(sent[0]?.['model'], 'nobody asked, so nothing is claimed').toBeUndefined()
    expect(sent[0]?.['effort'], 'and the same for the effort').toBeUndefined()

    await handle.setModel('gpt-5.6-terra')
    // ⚠️ `ultra` is the point of this line: it is Codex's own level, it is NOT in Claude's union,
    // and 024's neutral `'low'|'medium'|'high'` is the only reason it was unreachable. The adapter
    // deliberately does not second-guess it — the server owns that vocabulary and answers
    // `supportedReasoningEfforts` per model.
    await handle.setReasoningEffort('ultra')
    await turn('two')
    expect(sent[1]?.['model']).toBe('gpt-5.6-terra')
    expect(sent[1]?.['effort']).toBe('ultra')

    await handle.close()
    await consumer
  })

  it('the go-ahead switches the NEXT turn to {mode:"default"} — the measured ending', async () => {
    // ⚠️ This is the whole task, and it is measured rather than reasoned. The server's plan-mode
    // instructions say it stays in plan mode "until a developer message explicitly ends it", and no
    // client can write a developer-role message (`UserInput` has no such variant). 060 ran two
    // threads against the bundled 0.146.0 binary, same prompt, same sandbox, `approvalPolicy:
    // 'never'`: the turn that sent no `collaborationMode` produced ANOTHER PLAN and wrote nothing;
    // the turn that switched to `default` ran a command and wrote the file. The switch is the
    // ending. Nothing of ours is put in the conversation's mouth to achieve it.
    const { handle, sent, turn, consumer } = await planning()
    await turn('plan it')
    expect(sent[0]?.['collaborationMode']).toMatchObject({ mode: 'plan' })
    expect(handle.planNeedsGoAhead).toBe(true)

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead).toBe(false)

    await turn('Go ahead with this plan.')
    expect(sent[1]?.['collaborationMode']).toEqual({
      mode: 'default',
      // The same echoed settings as the plan turn: the server's own model back at it, so the
      // documented precedence over model/effort/instructions changes nothing but the mode.
      settings: { model: 'gpt-5.6-sol', reasoning_effort: null, developer_instructions: null },
    })
    await handle.close()
    await consumer
  })

  it('and KEEPS asserting it on every turn after — the sticky-mode trap in the other direction', async () => {
    // The thread's `collaborationMode` is sticky server-side. If the released session went quiet
    // after one `default`, a `turn/start` that never landed would leave the thread planning while
    // the session believed it had stopped — and nothing would ever say otherwise again. Re-asserting
    // is what makes the next turn correct whatever happened to the last one.
    const { handle, sent, turn, consumer } = await planning()
    await handle.setPlanMode(false)
    await turn('one')
    await turn('two')
    await turn('three')
    expect(sent.map((p) => (p['collaborationMode'] as { mode: string }).mode)).toEqual([
      'default',
      'default',
      'default',
    ])
    await handle.close()
    await consumer
  })

  it('a RESUMED session that was released comes back released (acceptance 3, across a restart)', async () => {
    // The durable half. Resumed as a plain "not planning" session, the adapter would send no mode at
    // all — and the thread's sticky value is whatever the last landed turn set, so a conversation the
    // user had released could quietly go back to proposing after a restart, with the bar gone.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planMode: true, planModeEnded: true },
    )
    expect(handle.planNeedsGoAhead, 'a released plan is not waiting on anyone').toBe(false)
    await handle.send('carry on')
    expect(sent[0]?.['collaborationMode']).toMatchObject({ mode: 'default' })
    await handle.close()
  })

  it('⚠️ but `planModeEnded` WITHOUT `planMode` sends nothing — the systemHint it would wipe', async () => {
    // The pair is read as a pair on purpose. Asserting `{mode:'default'}` on a thread that never
    // planned is not harmless: a collaboration mode takes precedence over developer instructions,
    // and `developer_instructions: null` means "use the built-in ones for this mode" — so it would
    // REPLACE the workspace instructions a `systemHint` put there (057 §6.3, 006's files). A stray
    // or malformed flag must therefore mean nothing at all rather than something quiet and wrong.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planModeEnded: true },
    )
    await handle.send('hello')
    expect(sent[0]).not.toHaveProperty('collaborationMode')
    expect(handle.planNeedsGoAhead).toBe(false)
    await handle.close()
  })

  it('refuses a go-ahead nobody asked for, and refuses a second one', async () => {
    // A button whose backing call quietly succeeded without doing anything is the failure this
    // codebase keeps naming. The second refusal matters just as much: by then the plan really has
    // been approved, and a call that "worked" would suggest it had not.
    const quiet = new FakeTransport()
    quiet.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const ordinary = await new CodexRuntime(adopt(quiet)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(ordinary.planNeedsGoAhead).toBe(false)
    await expect(ordinary.setPlanMode(false)).rejects.toThrow(/not planning/)
    await ordinary.close()

    const { handle, consumer } = await planning()
    await handle.setPlanMode(false)
    await expect(handle.setPlanMode(false)).rejects.toThrow(/already been given the go-ahead/)
    await handle.close()
    await consumer
  })

  it('refuses on a session that is over, BEFORE the flag moves (060 review)', async () => {
    // ⚠️ Ending plan mode writes no wire traffic, so on a closed session it would happily "succeed"
    // against something that can never send another turn. The host then persists `plan_ended_at`
    // and drops the bar, and the `send` meant to carry the switch fails — leaving a dead
    // conversation recorded as released. The second assertion is the one that matters: the refusal
    // left the state alone, so nothing downstream can act on a half-made change.
    const { handle, consumer } = await planning()
    await handle.close()
    await expect(handle.setPlanMode(false)).rejects.toThrow(/no longer active/)
    expect(handle.planNeedsGoAhead, 'a refused go-ahead must not have moved anything').toBe(true)
    await consumer
  })

  it('a released session with no reported model refuses the turn rather than dropping the switch', async () => {
    // ⚠️ The asymmetric half of 057's guard. Without the model the collaboration mode cannot be
    // built, and a `left` session that let the turn go anyway would send exactly the payload the
    // probe's CONTROL sent — no mode at all — which made the agent re-plan. So the failure of
    // dropping it here is not "the turn runs unplanned", it is "the go-ahead is silently withdrawn".
    const transport = new FakeTransport()
    const handshake = okThread('th_1')
    delete handshake['model']
    transport.onRequest('thread/start', () => handshake)
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
    })
    await handle.setPlanMode(false)
    await expect(handle.send('go ahead')).rejects.toThrow(/post-plan turn/)
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(false)
    // …and it does not brick the session either (057 review's lesson, re-checked on the new branch).
    expect(handle.status()).not.toBe('working')
    await handle.close()
  })

  it('an UNATTENDED session still runs unattended AFTER the go-ahead (acceptance 4, per 056)', async () => {
    // ⚠️ 056's hazard, third dispatch running: a consent surface consulted ABOVE the auto-approve
    // early return silently stops a yolo run until a human comes back. 057 refused to add a card
    // partly for that reason; 060 adds the affordance anyway, so it owns the risk — and the way it
    // is discharged is that the go-ahead is NOT a consent surface. Nothing waits on it, so an
    // unattended session that never receives one runs to completion, and one that does keeps its
    // profile intact.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.6-sol',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
      planMode: true,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)

    await handle.send('plan and go')
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    await handle.setPlanMode(false)
    await handle.send('Go ahead with this plan.')
    // Yolo survives the release, in both fields, on the very turn that carries the switch.
    expect(sent[1]?.['approvalPolicy'], 'yolo is not softened by the go-ahead').toBe('never')
    expect(sent[1]?.['sandboxPolicy']).toEqual({ type: 'dangerFullAccess' })
    expect(sent[1]?.['collaborationMode']).toMatchObject({ mode: 'default' })
    // And the strongest assertion is the negative one: nothing anywhere is waiting for a human.
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    await consumer
  })
})
