import { neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { waitFor } from './lib/runtime-host-sink-fixture'

describe('RuntimeHost — a wholesale grant is disclosed the moment it is made (058)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-grants-'))
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('pushes it MID-TURN, because the next message is too late to be told', async () => {
    // ⚠️ The bug this closes. `publishStateIfChanged` was reached only from `setApprovalMode`
    // and `send`, so a grant made while answering a card would have stayed invisible until the
    // user's next message — the one moment they no longer need telling, because by then the
    // session has already stopped asking. 031's rule is that a user can see what they granted, and
    // a card scrolls away.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const request = sink.find('permission_request')
    if (!request) throw new Error('no permission request')

    expect(sink.liveness.at(-1)?.approval?.blanketGrants ?? []).toEqual([])

    await host.respondPermission(
      created.sessionId,
      request.id,
      {
        outcome: 'allow_all_for_session',
      },
      sink,
    )

    // Named on the liveness channel, with no further turn and no further command. The Fake records
    // the grant faithfully — it is a conformance double, not a stub — so this is the real path.
    await waitFor(
      () => (sink.liveness.at(-1)?.approval?.blanketGrants ?? []).length > 0,
      'the grant disclosure on the liveness channel',
    )
    expect(sink.liveness.at(-1)?.approval?.blanketGrants).toEqual(['Bash'])

    // ⛔ **And the command RAN** (186, from 182 H4). This assertion did not exist, and its absence is
    // what let the double answer the widest of the three approvals with `skipped (denied)` for as
    // long as it did: a test that only checks the disclosure names the tool is green whether the
    // grant did anything or not. The disclosure is about a grant that HAPPENED — so the thing it is
    // about has to be asserted next to it.
    await waitFor(() => sink.types().includes('tool_result'), 'the tool result')
    const result = sink.find('tool_result')
    expect(result, 'a wholesale grant is an approval, not a refusal').toMatchObject({ ok: true })
  })

  it('and never asks about that tool again — the grant is standing, not a label (058)', async () => {
    // ⛔ **The other half of the same sentence, and the half nothing checked.** `permission.ts` says
    // `allow_all_for_session` means *"every future use of this tool this session, whatever its
    // arguments"*. The double recorded the grant for the header and then raised a card on the very
    // next turn, so every test above it certified a promise the double was not keeping.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const first = sink.find('permission_request')
    if (!first) throw new Error('no permission request')
    await host.respondPermission(
      created.sessionId,
      first.id,
      { outcome: 'allow_all_for_session' },
      sink,
    )
    await waitFor(() => sink.types().includes('turn'), 'the first turn ending')

    const cardsBefore = sink.types().filter((type) => type === 'permission_request').length
    const turnsBefore = sink.types().filter((type) => type === 'turn').length
    await host.send(created.sessionId, 'do it again', sink)
    await waitFor(
      () => sink.types().filter((type) => type === 'turn').length > turnsBefore,
      'the second turn ending',
    )

    // The second turn ran the tool and asked nothing. Both halves: a turn that never happened would
    // satisfy the card count on its own.
    expect(sink.types().filter((type) => type === 'permission_request').length).toBe(cardsBefore)
    expect(sink.events().filter((event) => event.type === 'tool_result')).toHaveLength(2)
  })

  it('says nothing when nothing was granted wholesale', async () => {
    // The other direction, and the one that keeps the pill meaningful: its APPEARANCE is the news,
    // so an ordinary approval must not produce one. A `deny` must not either.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const request = sink.find('permission_request')
    if (!request) throw new Error('no permission request')

    await host.respondPermission(created.sessionId, request.id, { outcome: 'allow' }, sink)
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')
    expect(sink.liveness.at(-1)?.approval?.blanketGrants ?? []).toEqual([])
  })
})

describe('RuntimeHost — changing a setting mid-conversation (076)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /** Every durable write, so "it was recorded" is checked rather than assumed. */
  let writes: string[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-live-settings-'))
    writes = []
    let counter = 0
    host = new RuntimeHost({
      store: {
        ...NULL_SESSION_STORE,
        setModel: (sessionId, model) => writes.push(`model:${sessionId}:${model ?? '(none)'}`),
        setReasoningEffort: (sessionId, effort) =>
          writes.push(`effort:${sessionId}:${effort ?? '(none)'}`),
        startPlanMode: (sessionId) => writes.push(`planOn:${sessionId}`),
        endPlanMode: (sessionId) => writes.push(`planOff:${sessionId}`),
      },
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('records the change and publishes it, so a second window is not left behind', async () => {
    // Persisting is what makes the control mean anything past a restart: a session resumed from a
    // stale row would quietly go back to the model the conversation opened with, and nothing on
    // screen would explain it. Publishing is the same argument across windows.
    const created = await host.createSession({ provider: 'claude' }, sink)
    const { settings: after } = await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'model',
        model: 'haiku',
      },
      sink,
    )
    expect(writes).toEqual([`model:${created.sessionId}:haiku`])
    expect(after.pendingModel, 'the change is queued, not claimed as running').toEqual({
      value: 'haiku',
    })
    // ⚑ D-042 · what was running is R1's pair — Claude's `default`, by name — never an absence.
    expect(after.model, 'and what is RUNNING is still what was running').toBe('default')
    expect(sink.liveness.at(-1)?.settings?.pendingModel).toEqual({ value: 'haiku' })

    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: undefined },
      sink,
    )
    // ⚑ **D-042 · "stop asking" is now "the model's own default", NAMED** (R1): `haiku` is no row
    // of the Fake's list, so it runs at Claude's default effort by name, `medium` (W4.28) — still a write,
    // and ⛔ never the absence it used to write.
    expect(writes.at(-1), '"stop asking" is a write, not a skipped one').toBe(
      `effort:${created.sessionId}:medium`,
    )
    expect(writes).not.toContain(`effort:${created.sessionId}:(none)`)
  })

  it('refuses to turn plan mode OFF as a setting — that gesture is the go-ahead (the 076 ruling)', async () => {
    // ⚠️ **And it refuses BEFORE the handle moves.** Releasing a plan without sending anything
    // leaves a conversation that has been told to stop planning and given nothing to do; recording
    // it would then be a row saying "released" for a conversation that never said so. The wire
    // schema types this `true`, so this is the belt to that schema's braces — reachable only from a
    // caller inside the main process, which is exactly where a future mistake would come from.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    expect(created.planNeedsGoAhead).toBe(true)
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: false as true }, sink),
    ).rejects.toThrow(/go-ahead/)
    expect(writes, 'nothing was recorded').toEqual([])
    // ⚠️ **Asserted on the QUEUED value, not the running one**, and a mutation is what taught me the
    // difference. `settings.planMode` is what the last turn ran with, and it does not move until a
    // turn adopts a change — so a handle that had wrongly been released already would look
    // identical here. `planNeedsGoAhead` reads `requested`, so it flips the instant the phase moves:
    // it is the only reading that can tell "refused before anything moved" from "moved, then
    // refused".
    const { settings: still } = await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'reasoningEffort',
        effort: 'high',
      },
      sink,
    )
    expect(still.pendingPlanMode, 'no release was queued').toBeNull()
    expect(still.planMode, 'and it is still planning').toBe(true)
    const live = sink.liveness.at(-1)
    expect(live?.plan?.planNeedsGoAhead, 'the plan still needs its go-ahead').toBe(true)
  })

  it('republishes a settings-only change, so a second window is not left behind (found in review)', async () => {
    // ⚠️ **The dedupe key excluded `settings`, and that made the whole feature invisible to every
    // window but one.** `publishStateIfChanged` keyed on `{approval, plan}`; a model or effort
    // change moves neither, so the key compared equal and the function returned before sending
    // anything. The issuing window looked correct — it patches itself from the command result — so
    // two open windows silently disagreed about what a live conversation was running.
    //
    // Asserted on the LIVENESS channel specifically, because that is the half that was broken; the
    // command result was right all along and would have hidden this.
    const created = await host.createSession({ provider: 'claude' }, sink)
    // ⚠️ **A first change is made before the measurement, and that is not ceremony.** `lastDisclosures`
    // starts unset, so the FIRST publish on a session goes out whatever the key contains — a version
    // of this test that measured from session creation passed against the bug, which a mutation
    // showed. The baseline has to be a session that has already published once.
    await host.setSessionSetting(created.sessionId, { kind: 'model', model: 'haiku' }, sink)
    expect(sink.liveness.at(-1)?.settings?.pendingModel).toEqual({ value: 'haiku' })
    const before = sink.liveness.length

    // Now a change that moves ONLY the settings — neither the approval nor the plan disclosure —
    // which is precisely what the old key could not see.
    //
    // ⚑ **D-042 · `low`, because the start already runs at `high`** (R1 names Claude's default
    // effort by name), so asking for `high` would move nothing and there would be nothing to see.
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: 'low' },
      sink,
    )
    expect(sink.liveness.length, 'a settings-only change is published').toBeGreaterThan(before)
    expect(sink.liveness.at(-1)?.settings?.pendingReasoningEffort).toEqual({ value: 'low' })

    // …and the dedupe still works, so this is not "publish everything always". Re-requesting the
    // same value changes nothing and must stay quiet.
    const after = sink.liveness.length
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: 'low' },
      sink,
    )
    expect(sink.liveness.length, 'an unchanged setting is still deduped').toBe(after)
  })

  it('turning plan mode ON is recorded as the pair a resume reads', async () => {
    // 060 wrote `plan_ended_at` and never cleared it, on the stated grounds that "a live
    // conversation has no way back into plan mode on either provider". 076 gave it one, so the pair
    // has to move back — and both columns move in ONE statement, because `plan_mode = 1` beside a
    // surviving `plan_ended_at` is "planned and released", which would have the Codex adapter assert
    // `{mode:'default'}` on a session the user has just asked to plan.
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink)
    expect(writes).toEqual([`planOn:${created.sessionId}`])
    expect(sink.liveness.at(-1)?.settings?.pendingPlanMode).toBe(true)
  })

  it('does not record a change the session refused', async () => {
    // The handle goes first and a rejection stops everything: each adapter refuses what it cannot
    // deliver, so letting the row move first would persist a change the provider never accepted —
    // and the next resume would apply it.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink),
    ).resolves.toBeDefined()
    writes.length = 0
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink),
    ).rejects.toThrow(/already planning/)
    expect(writes).toEqual([])
  })
})

describe('RuntimeHost — the go-ahead that releases a plan (060)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /** Every durable write the gesture makes, so "it was recorded" is checked and not assumed. */
  let ended: { sessionId: string; at: number }[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-goahead-'))
    ended = []
    let counter = 0
    host = new RuntimeHost({
      store: {
        ...NULL_SESSION_STORE,
        endPlanMode: (sessionId, at) => ended.push({ sessionId, at }),
      },
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('ends the mode, records it, sends the message — and says so on the liveness channel', async () => {
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    // The bar is offered from the FIRST frame, before any plan document exists: the state that
    // makes it meaningful is the launch setting, not the arrival of a proposal.
    expect(created.planNeedsGoAhead).toBe(true)

    await host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.')

    // 1 — the mode really changed, read back from the handle rather than from anything the host kept.
    await waitFor(
      () => sink.liveness.at(-1)?.plan?.planNeedsGoAhead === false,
      'the released plan on the liveness channel',
    )
    // 2 — …durably, so a resume cannot put the conversation back to proposing.
    expect(ended.map((row) => row.sessionId)).toEqual([created.sessionId])
    // 3 — …and the go-ahead is in the transcript as the message it is, not whispered to the
    //     provider behind the conversation's back — carrying the one thing that was missing until
    //     278 §1: who wrote it. ⛔ **`toEqual`, not `toMatchObject`**, and the swap is the finding:
    //     the defect was an ABSENT field, and a partial match passes over an absent field by
    //     construction, so this assertion was green for the whole life of the bug it is nearest to.
    // ⚑ **F093 · R2 — and the whole text it was handed**, which for the go-ahead is its words.
    expect(sink.events().filter((e) => e.type === 'user_turn')).toEqual([
      {
        type: 'user_turn',
        text: 'Go ahead with this plan.',
        attribution: 'app_authored',
        sent: 'Go ahead with this plan.',
      },
    ])
  })

  it('⚠️ the liveness dedupe covers the PLAN half, not just the approval half', async () => {
    // The trap this closes. `publishStateIfChanged` keys on a JSON string, and keyed on the
    // approval disclosure alone a go-ahead — which changes only the plan half — would compare equal
    // and publish nothing at all. The button would then still be on screen after being pressed,
    // in this window and in any other watching the same conversation.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    await waitFor(() => sink.liveness.length > 0, 'an initial liveness message')
    const approvalBefore = JSON.stringify(sink.liveness.at(-1)?.approval)

    await host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.')
    await waitFor(
      () => sink.liveness.at(-1)?.plan?.planNeedsGoAhead === false,
      'a republish carrying only a plan change',
    )
    // The approval half is byte-identical across that publish — which is exactly why a key over it
    // alone would have swallowed the message.
    expect(JSON.stringify(sink.liveness.at(-1)?.approval)).toBe(approvalBefore)
  })

  it('refuses a session that is not planning, and records nothing when it does', async () => {
    // A refusal has to leave no trace: a `plan_ended_at` on a row that never planned would have the
    // adapter assert a collaboration mode on a thread that has none, replacing its developer
    // instructions — the workspace hint. So the throw comes BEFORE the write, not after it.
    const created = await host.createSession({ provider: 'codex' }, sink)
    // The WORDING is the adapter's and it moved with 076: ending plan mode and turning plan mode off
    // became one verb, so the refusal now names the transition that was impossible instead of the
    // command that no longer exists. What is asserted below — that nothing was written and nothing
    // was said — is the behaviour, and it is unchanged.
    await expect(host.endPlanMode(created.sessionId, sink, 'go on then')).rejects.toThrow(
      /was not planning/,
    )
    expect(ended).toEqual([])
    expect(sink.events().some((e) => e.type === 'user_turn')).toBe(false)
  })

  it('⚠️ refuses BEFORE anything moves when the conversation could not take the message (060 review)', async () => {
    // The composition's failure mode. `endPlanMode` does two things and only the second can fail
    // for ordinary reasons — a turn already running, a session that has ended. Without the guard the
    // first would land, be written to the row and be announced to every window, and only then would
    // the send throw: a conversation recorded as released, its bar gone, that never said anything.
    //
    // Driven through a REAL busy session rather than a stub, because "busy" here has to mean what
    // the rest of the host means by it.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    await host.send(created.sessionId, 'plan it', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'a turn to be running')

    await expect(
      host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.'),
    ).rejects.toThrow(/still working/)
    // Nothing moved: no row written, no message sent, and the bar is still on offer.
    expect(ended).toEqual([])
    expect(sink.events().some((e) => e.type === 'user_turn' && e.text.startsWith('Go ahead'))).toBe(
      false,
    )
    expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(true)
  })

  /**
   * The way out that is not an approval (085).
   *
   * Leaving plan mode must not imply approval of a disliked plan. Plan-off and a go-ahead
   * share a wire transition, but that does not require sending `Go ahead with this plan.`
   * with every mode change.
   */
  describe('…and the way out that is NOT an approval (085)', () => {
    it('releases the plan and says nothing at all', async () => {
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead, 'positive: it was planning').toBe(true)

      await host.endPlanMode(created.sessionId, sink)

      // Released, durably, by exactly the same write the go-ahead makes — one transition.
      expect(ended.map((e) => e.sessionId)).toEqual([created.sessionId])
      expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(false)
      // And the whole difference from the go-ahead: nothing was put in the user's mouth.
      expect(sink.events().some((e) => e.type === 'user_turn')).toBe(false)
    })

    it('does NOT inherit the send guard — leaving works while a turn is running', async () => {
      // ⚠️ The asymmetry is the feature. The go-ahead's `idle` guard exists because it SENDS and the
      // send can fail; leaving has no second operation, and the mode change rides the next
      // `turn/start`, which has not happened yet. Being made to wait for a turn to finish before you
      // may stop steering it is the opposite of leaving at will.
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      await host.send(created.sessionId, 'plan it', sink)
      await waitFor(() => sink.types().includes('permission_request'), 'a turn to be running')

      // Positive AND negative on the same session, in the same breath: the go-ahead is refused…
      await expect(
        host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.'),
      ).rejects.toThrow(/still working/)
      // …and leaving is not.
      await host.endPlanMode(created.sessionId, sink)
      expect(ended.map((e) => e.sessionId)).toEqual([created.sessionId])
      expect(
        sink.events().some((e) => e.type === 'user_turn' && e.text.startsWith('Go ahead')),
      ).toBe(false)
    })

    it('a conversation that is over cannot be left — there is no next turn to carry it', async () => {
      // ⚠️ Written expecting `cannot leave planning: this conversation is over` and it is NOT what
      // comes back: closing DEREGISTERS the session, so the host never reaches the status guard.
      // Pinned as measured rather than as designed. The guard still earns its place for the session
      // that terminalises itself — a fatal provider error leaves the record registered and `ended` —
      // which the Fake cannot drive from here; that path is named in the response doc, not claimed.
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      await host.close(created.sessionId, sink)
      await expect(host.endPlanMode(created.sessionId, sink)).rejects.toThrow(/unknown session/)
      expect(ended, 'nothing was written for a conversation that is gone').toEqual([])
    })

    it('a session that never planned refuses to be left, exactly as it refuses the go-ahead', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      await expect(host.endPlanMode(created.sessionId, sink)).rejects.toThrow(/was not planning/)
      expect(ended).toEqual([])
    })
  })

  it('a planning session asks for NOTHING a plain one does not (acceptance 4, host layer)', async () => {
    // ⚠️ 056's hazard, checked where this dispatch could have re-introduced it: a consent surface
    // consulted above the auto-approve early return silently stops an unattended run. The go-ahead
    // avoids that by not being one — nothing waits on it — and what that buys, seen from here, is
    // that turning plan mode on adds no request to the stream.
    //
    // ⛔ **This paragraph used to read "`FakeRuntime`'s representative turn always raises one card,
    // by design and in every mode"** — and it did, which is the contradiction 182 H4 named and 186
    // fixed. The comparison was built AROUND the double's defect: it could not assert the honest
    // thing (an unattended session asks nobody anything) because the double asked anyway, so it
    // settled for "both ask the same amount" and waited for a card yolo should never have produced.
    //
    // Both halves are asserted now, and the comparison stays: the equality is what catches a
    // consent surface added above the auto-approve return for planning sessions only, and the
    // emptiness is 056's hazard said plainly.
    const plain = new RecordingSink()
    const planning = new RecordingSink()
    const a = await host.createSession({ provider: 'codex', approvalMode: 'auto' }, plain)
    const b = await host.createSession(
      { provider: 'codex', approvalMode: 'auto', planMode: true },
      planning,
    )
    await host.send(a.sessionId, 'go', sink)
    await host.send(b.sessionId, 'plan and go', sink)
    const awaited = (s: RecordingSink): string[] =>
      s.types().filter((t) => t === 'permission_request' || t === 'user_input_request')
    // Waited on the TURN ENDING rather than on a card, which is what an unattended turn actually
    // does — and it is the positive that keeps the two negatives below from passing over nothing.
    await waitFor(() => plain.types().includes('turn'), 'the plain turn to finish')
    await waitFor(() => planning.types().includes('turn'), 'the planning turn to finish')
    expect(awaited(planning)).toEqual(awaited(plain))
    expect(awaited(plain), 'an unattended session asks nobody anything').toEqual([])
    // …and the plan is still on offer through all of it, so the affordance consumed nothing either.
    expect(planning.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(true)
  })
})
