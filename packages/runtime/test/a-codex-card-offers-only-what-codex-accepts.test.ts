import { describe, expect, it, vi } from 'vitest'
import {
  type PermissionOutcome,
  type PermissionScope,
  ALWAYS_HONOURED,
  isAlwaysHonoured,
  type RuntimeEvent,
} from '../src/index'
import { CodexRuntime } from '../src/codex'
import {
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodexInTurn,
  scopeOf,
  commandParams,
} from './helpers/fake-codex-transport'

describe('CodexRuntime — approval scope disclosure (007 P1-7)', () => {
  it('always allows a cancel (turn-kill) even when the request omits it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(56, 'item/commandExecution/requestApproval', {
      ...commandParams,
      availableDecisions: ['accept', 'decline'], // no cancel offered
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:56', { outcome: 'cancel' }) // not rejected
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 56)).toBe(true))
    await handle.close()
    await consumer
  })

  /**
   * Assert each published offer as literals. Deriving expectations from ALWAYS_HONOURED would
   * let a narrowed floor change both subject and oracle without failing. Six exact rows catch
   * a narrowed floor or a producer that omits publishedOffer; exhaustiveness catches new shapes.
   * The absent-list and file-approval controls still carry positive choices, unlike the other four.
   */
  it('🔴 every published offer keeps both refusals, and only four of six can be allowed (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const publishedBy = async (
      id: number,
      method: string,
      params: Record<string, unknown>,
    ): Promise<{ offer: PermissionOutcome[]; because: string | undefined }> => {
      transport.serverRequest(id, method, params)
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === `number:${id}`)).toBe(
          true,
        ),
      )
      const card = events.find(
        (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          e.type === 'permission_request' && e.id === `number:${id}`,
      )
      if (card === undefined) throw new Error(`no card for number:${id}`)
      return { offer: card.scope.availableDecisions, because: card.scope.noPositiveBecause }
    }
    const COMMAND = 'item/commandExecution/requestApproval'
    const UNDISPLAYABLE = {
      network: { enabled: false },
      fileSystem: {
        read: null,
        write: null,
        entries: [
          { path: { type: 'special', value: { kind: 'unknown', path: '/???' } }, access: 'write' },
        ],
      },
    }

    // ⛔ REPAIRED · the provider enumerated, and its list has no cancel. Ours has one anyway, and
    // the card can still be allowed, so it owes no reason.
    expect(
      await publishedBy(70, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
      }),
    ).toEqual({ offer: ['allow', 'deny', 'cancel'], because: undefined })

    // ⛔ REPAIRED · an explicit empty list — the provider named no way to allow, and said so by
    // enumerating nothing.
    expect(await publishedBy(71, COMMAND, { ...commandParams, availableDecisions: [] })).toEqual({
      offer: ['deny', 'cancel'],
      because: 'none-was-offered',
    })

    // ⛔ REPAIRED · an object-only list. The provider DID offer a way to accept; this app has no
    // neutral outcome for an amendment-form decision, so it could not put it on a card.
    // ⚑ 736 · R95 gave the WIRE shape one (`allow_always`); this `rules` key is not the wire's
    // `execpolicy_amendment`, so it is a look-alike this app will not echo, and still unrepresentable.
    expect(
      await publishedBy(74, COMMAND, {
        ...commandParams,
        availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-represent-the-answers' })

    // 🔴 REPAIRED · and the one `483` traced as REACHABLE: the provider offered `accept`, and
    // BroBot withheld every positive because the grant riding along could not be displayed.
    expect(
      await publishedBy(75, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
        additionalPermissions: UNDISPLAYABLE,
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-describe-the-grant' })

    // ⚑ CONTROL · no list at all → the sanctioned standard set, which already carried the floor.
    const noList: Record<string, unknown> = { ...commandParams }
    delete noList['availableDecisions']
    expect(await publishedBy(72, COMMAND, noList)).toEqual({
      offer: ['allow', 'allow_for_session', 'deny', 'cancel'],
      because: undefined,
    })

    // ⚑ CONTROL · a file approval, which never enumerates and never fell short.
    expect(
      await publishedBy(73, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_9',
        startedAtMs: 0,
        reason: 'apply patch',
      }),
    ).toEqual({ offer: ['allow', 'allow_for_session', 'deny', 'cancel'], because: undefined })

    // 🔴 **The class, over every card this run published** — so a producer added to this adapter
    // and exercised anywhere above cannot fall short without failing here, and the six literals
    // above cannot all drift the same way unnoticed.
    const published = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(published.length).toBe(6)
    for (const card of published) {
      for (const refusal of ALWAYS_HONOURED) {
        expect(
          card.scope.availableDecisions,
          `${card.id} published an offer without ${refusal}`,
        ).toContain(refusal)
      }
      // ⛔ **The word is present exactly when there is no way to allow** — an unenumerated
      // positive-less state is the thing `482` found and this is what stops a second one.
      const canBeAllowed = card.scope.availableDecisions.some(
        (outcome) => !isAlwaysHonoured(outcome),
      )
      expect(card.scope.noPositiveBecause === undefined, `${card.id} said the wrong thing`).toBe(
        canBeAllowed,
      )
    }

    await handle.close()
    await consumer
  })

  /**
   * 🔴 **487 · keeping the refusals must not disclose the shape that could not be described.**
   *
   * ⛔ **That is the whole reason the positives are withheld.** ⚠️ Before 487 the fail-closed fact
   * rode on `availableDecisions: []` — a channel `publishedOffer` spends — so the repair had to
   * write the fact explicitly, and a written fact is a fact that can say too much.
   *
   * ⚑ **The measurement: eleven undisplayable shapes, one published answer.** Every branch of
   * `permissionProfileDisclosure` and `fileSystemDisclosure` that can set `faithful:false` is
   * driven here, and every field of the published scope is compared — **except `paths`**.
   *
   * 🔴 **`paths` is the exception, it is stated rather than hidden, and 487 did not create it**
   * (this claim was over-stated in the first draft and corrected by the dispatch's own review).
   * `commandScope` appends `requested.labels` unconditionally, so a profile with an unknown
   * top-level key beside a readable `fileSystem` publishes the labels it COULD read while one
   * that is not a record publishes none. ⛔ **The leak is one-directional and pre-existing**: the
   * list carries what was representable and is silent about what was not, so an omission is
   * unobservable against nothing — and it was exactly this observable before 487, when the fact
   * rode on an empty `availableDecisions` instead of on a word. ⚠️ **What 487 must not do is
   * ADD a bit**, and the equality below is what says it did not.
   *
   * ⚠️ **And the control is a shape that IS displayable**, so the equality above is not the
   * equality of a card that never differs from any other.
   */
  /**
   * ⚠️ **487 · a value this adapter cannot read is not a value it can describe** (corrected by
   * this dispatch's own review).
   *
   * ⛔ **`outcomeOfCodexDecision`'s `default:` arm returns `null` for the network-amendment accept
   * and an exec-policy look-alike (the well-formed one is `allow_always` since `736`) AND for
   * anything else it does not recognise** — a renamed verb, a number, a
   * malformed element. The comment beside it names only the amendment forms, and the first draft
   * of `could-not-represent-the-answers`'s sentence went further and asserted *"the ways to
   * ACCEPT it were offered"*, which this app cannot know: a token it could not read might have
   * been a refusal.
   *
   * ⚑ **The word is unchanged and the sentence is** — it now says *part of what this request
   * offered came in a form BroBot cannot put on a card*, which is exactly what was observed and
   * is true of both inputs below.
   */
  it('⚠️ an unreadable token is described as unreadable, never as an accept (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(76, 'item/commandExecution/requestApproval', {
      ...commandParams,
      // ⛔ Two refusals this app maps, and one token it does not. No accept was offered at all.
      availableDecisions: ['decline', 'cancel', 'somethingThisAppCannotRead'],
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'permission_request' && e.id === 'number:76')).toBe(
        true,
      ),
    )
    const card = events.find(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request' && e.id === 'number:76',
    )
    expect(card?.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(card?.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    await handle.close()
    await consumer
  })

  it('🔴 every undisplayable shape publishes ONE answer, and it names none of them (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const UNKNOWN_PATH = {
      path: { type: 'special', value: { kind: 'unknown', path: '/???' } },
      access: 'write',
    }
    // ⛔ Named so a failure says WHICH branch moved, and exhaustive over the ways `faithful` dies.
    const UNDISPLAYABLE: Record<string, unknown> = {
      'not a record at all': 'everything',
      'an array, which isRecord accepts': ['read'],
      'an unrecognised top-level key': { fileSystem: { read: ['/a'] }, scopes: 1 },
      'a network that is not a record': { network: true },
      'an unrecognised network key': { network: { enabled: true, allowedHosts: ['x'] } },
      'a fileSystem that is not a record': { fileSystem: 'everything' },
      'an unrecognised fileSystem key': { fileSystem: { read: ['/a'], sockets: [] } },
      'a read that is not an array': { fileSystem: { read: '/a' } },
      'a path element that is not a string': { fileSystem: { read: [7] } },
      'entries that are not an array': { fileSystem: { entries: {} } },
      'an entry we have no label for': { fileSystem: { entries: [UNKNOWN_PATH] } },
    }

    const published = new Map<
      string,
      { scope: Omit<PermissionScope, 'paths'>; pathsLength: number }
    >()
    let id = 80
    for (const [name, additionalPermissions] of Object.entries(UNDISPLAYABLE)) {
      id += 1
      transport.serverRequest(id, 'item/commandExecution/requestApproval', {
        command: 'setup',
        cwd: '/tmp/x',
        availableDecisions: ['accept', 'decline'],
        additionalPermissions,
      })
      const at = `number:${id}`
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === at)).toBe(true),
      )
      const card = events.find(
        (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          e.type === 'permission_request' && e.id === at,
      )
      // ⛔ **The WHOLE scope minus `paths`**, so a field added to the event later cannot start
      // carrying the shape without failing here. `paths` is compared separately below.
      if (card === undefined) throw new Error(`no card for ${at}`)
      const { paths, ...rest } = card.scope
      published.set(name, { scope: rest, pathsLength: paths.length })
    }

    // 🔴 **One answer, eleven times.** Written as a per-shape map so a failure names the shape.
    const one = {
      scope: {
        cwd: '/tmp/x',
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['deny', 'cancel'],
        noPositiveBecause: 'could-not-describe-the-grant',
        underDisclosed: true,
        approvalMode: 'ask',
      },
      // ⚠️ **Only the two shapes that carry a readable `fileSystem` publish a label** — see the
      // docblock: pre-existing, one-directional, and unchanged by 487.
      pathsLength: 0,
    }
    // 🔴 **Measured, and exact rather than `any(Number)`** — a bound written as *some number*
    // would have hidden a shape that started publishing more. ⛔ **Two of the eleven publish a
    // label**, and both for the same reason: their profile carries a `fileSystem` this app CAN
    // read beside the key it cannot. ⚑ Nine publish none, so nine are byte-identical events.
    const LABELS_PUBLISHED: Readonly<Record<string, number>> = {
      'an unrecognised top-level key': 1,
      'an unrecognised fileSystem key': 1,
    }
    expect(Object.fromEntries(published)).toEqual(
      Object.fromEntries(
        Object.keys(UNDISPLAYABLE).map((name) => [
          name,
          { ...one, pathsLength: LABELS_PUBLISHED[name] ?? 0 },
        ]),
      ),
    )
    // ⛔ **And the part that IS the bound**: every shape publishes the identical offer and the
    // identical word, whatever its `paths` did.
    for (const [name, row] of published) {
      expect(row.scope.availableDecisions, name).toEqual(['deny', 'cancel'])
      expect(row.scope.noPositiveBecause, name).toBe('could-not-describe-the-grant')
    }

    // ⚑ **The control**: the same request with a profile we CAN display publishes the positive
    // and no word at all — so the equality above is measuring something.
    transport.serverRequest(99, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      additionalPermissions: { fileSystem: { read: ['/a'] }, network: { enabled: true } },
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'permission_request' && e.id === 'number:99')).toBe(
        true,
      ),
    )
    const shown = events.find(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request' && e.id === 'number:99',
    )
    expect(shown?.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(shown?.scope.noPositiveBecause).toBeUndefined()

    await handle.close()
    await consumer
  })

  it('does NOT leak the raw provider payload into the neutral event', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(51, 'item/commandExecution/requestApproval', commandParams)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(new Set(Object.keys(req))).toEqual(
      new Set(['type', 'id', 'kind', 'action', 'detail', 'scope']),
    )
    const serialized = JSON.stringify(req)
    for (const leak of [
      'threadId',
      'turnId',
      'itemId',
      'startedAtMs',
      'commandActions',
      'networkApprovalContext',
      'additionalPermissions',
    ]) {
      expect(serialized).not.toContain(leak)
    }
    await handle.close()
    await consumer
  })

  it('maps a file approval grant root to a session-wide scope', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(52, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_2',
      startedAtMs: 0,
      reason: 'apply patch',
      grantRoot: '/tmp/x/src',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.kind).toBe('file')
    expect(req.scope).toMatchObject({
      grantRoot: '/tmp/x/src',
      persistence: 'session',
      paths: ['/tmp/x/src'],
    })
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **697 — a file card with NO grant root still offers `allow for this session`, so it says
   * `session`.** ⛔ On `main` it said `once` beside that button — measured live by
   * `probe:codex-reopen-grant` on every file card it raised — which is `058`'s *"the same class of
   * lie in the other direction"*. ⚑ The grant-root card above is the control: `session` before and
   * after, for the reason it always had.
   */
  it('697 · a file card with no grant root says what its session button can grant', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(55, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: 'apply patch',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.kind).toBe('file')
    // ⚑ The premise: the session accept IS on the card.
    expect(req.scope.availableDecisions).toContain('allow_for_session')
    expect(req.scope.grantRoot).toBeUndefined()
    expect(req.scope.persistence).toBe('session')
    await handle.close()
    await consumer
  })

  it('rejects a respondPermission decision the request does not offer', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(53, 'item/commandExecution/requestApproval', {
      ...commandParams,
      availableDecisions: ['decline', 'cancel'], // no accept offered
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // 'allow' → 'accept' is not offered → rejected, request stays pending
    await expect(handle.respondPermission('number:53', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    // 'deny' → 'decline' is offered → accepted
    await handle.respondPermission('number:53', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 53)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an explicit list with a mix of amendment-form + decline surfaces ONLY the representable set, no invented allow (023 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(60, 'item/commandExecution/requestApproval', {
      command: 'curl http://x',
      cwd: '/tmp/x',
      // Provider offers an amendment-form accept (object) + a plain decline — NO plain accept.
      // ⚑ 736 · a LOOK-ALIKE: `rules` is not the wire's `execpolicy_amendment`, so it is still
      // unrepresentable; the wire shape is `allow_always` since R95 (the R95 tests, `approvals`).
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }, 'decline'],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · the representable offered decision, and the floor.** The provider's `decline`
    // maps to `deny`; `cancel` is here because every published offer keeps both refusals, and
    // NOT because an accept was invented — there is still no positive on this card.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    // 🔴 **487 · and the card says WHY it cannot be allowed**: the provider offered a way to
    // accept and this app has no neutral outcome for an amendment-form decision.
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true) // an unrepresentable amendment-form decision was offered
    expect(req.scope.amendments).toContainEqual({ kind: 'exec', detail: 'curl *' }) // the amendment is surfaced, not dropped
    // Plain allow ('accept') was NOT offered → rejected, never sent on the wire.
    await expect(handle.respondPermission('number:60', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses.some((r) => r.id === 60)).toBe(false)
    await handle.close()
    await consumer
  })

  it('an explicit list with ONLY an amendment-form accept yields NO WAY TO ALLOW, says why, and fails closed (023 P1-F · 487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(61, 'item/commandExecution/requestApproval', {
      command: 'curl http://x',
      cwd: '/tmp/x',
      // ⚑ 736 · a LOOK-ALIKE (`rules`, not the wire's `execpolicy_amendment`) — still unrepresentable.
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · no representable POSITIVE — and never the standard 4-set.** The two refusals are
    // on it because both gates honour them whatever was offered; the card could not be answered
    // at all before, which is `483`'s repair 1.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true)
    // Both positive outcomes fail closed (unoffered); only a safe cancel/decline works.
    await expect(handle.respondPermission('number:61', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    // ⚑ 736 · and the look-alike is never echoed as an *Always allow* either.
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_always' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 61)).toBe(false) // nothing sent on the wire
    await handle.respondPermission('number:61', { outcome: 'cancel' }) // safe fallback always works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 61)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an explicit EMPTY availableDecisions:[] offers no way to ALLOW — no positive decision reaches the wire (036 P1-F #3 · 487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // PRESENT-but-empty ≠ absent: the provider enumerated a list and it offers no decision.
    // Pre-fix `length > 0` treated this as "absent" and widened it to all four standard choices,
    // then accepted a positive decision the provider never offered.
    transport.serverRequest(62, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
      availableDecisions: [],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · NOT the invented allow/session/deny/cancel set**, and not nothing either: the
    // provider named no way to allow, so the card carries the two refusals and says that.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('none-was-offered')
    // The whole command is shown and Codex offered nothing the card cannot draw: no warning.
    expect(req.scope.underDisclosed).toBe(false)
    // Every positive outcome fails closed; nothing is written to the wire.
    await expect(handle.respondPermission('number:62', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:62', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 62)).toBe(false)
    // The safe negatives still work (so the turn can always proceed).
    await handle.respondPermission('number:62', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 62)).toBe(true))
    await handle.close()
    await consumer
  })

  it('a command with nothing picked out of it is disclosed by the command itself, which the card shows whole', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // Its network and file effects appear in no field but the command, and the card draws no list
    // beside it that could be read as all it touches: the command is the disclosure, as on
    // Claude's shell card.
    transport.serverRequest(63, 'item/commandExecution/requestApproval', {
      command: 'curl https://api.example | tee /etc/cron.d/x',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'], // representable, and no additionalPermissions
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.underDisclosed).toBe(false)
    expect(req.detail).toBe('curl https://api.example | tee /etc/cron.d/x')
    expect(req.scope.paths).toEqual([])
    expect(req.scope.networkHosts).toEqual([])
    await handle.close()
    await consumer
  })

  it('a command requesting filesystem entries DISCLOSES them access-labelled (path/glob/special) (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(64, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      // The REAL AdditionalFileSystemPermissions shape: legacy read/write + the newer `entries`.
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: ['/tmp/x/legacy'],
          entries: [
            { path: { type: 'path', path: '/etc' }, access: 'write' },
            { path: { type: 'glob_pattern', pattern: '**/*.ts' }, access: 'read' },
            { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'write' },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // Pre-fix the UI saw NONE of this (paths: []) while accepting granted it all.
    expect(req.scope.paths).toEqual([
      'write /tmp/x/legacy',
      'write /etc',
      'read glob:**/*.ts',
      'write special:tmpdir',
    ])
    expect(req.scope.underDisclosed).toBe(true)
    // Everything requested is displayable, so the offered accept remains available.
    await handle.respondPermission('number:64', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 64)).toBe(true))
    expect(transport.responses.find((r) => r.id === 64)?.result).toEqual({ decision: 'accept' })
    await handle.close()
    await consumer
  })

  it('a command whose requested permissions are NOT displayable fails positives closed (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(65, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'], // accept IS offered…
      additionalPermissions: {
        network: { enabled: false },
        // …but a `special:unknown` path cannot be shown truthfully, so accepting would grant
        // filesystem access the user never saw.
        fileSystem: {
          read: null,
          write: null,
          entries: [
            {
              path: { type: 'special', value: { kind: 'unknown', path: '/???', subpath: null } },
              access: 'write',
            },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    // 🔴 **487 · the invariant, re-argued rather than renumbered.** The rule was *the card must
    // not ADVERTISE a decision the gate will reject*, and it held by making the offer a subset of
    // the gate. ⛔ **The gate was never the offered set alone**: `respondPermission` exempts
    // {@link ALWAYS_HONOURED} by construction, so the honest statement of the rule is **every
    // POSITIVE on a card is one the gate admits, and the two refusals are admitted always**. The
    // old form was the strictly-smaller offer that satisfied it, and on this branch — the one
    // `483` traced as reachable — it left a person a card with no answer at all.
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    // ⚑ **And it says whose decision that was.** The provider offered `accept`; BroBot withheld
    // it because the grant riding along could not be shown.
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    // Positives fail closed even though the provider offered accept — nothing on the wire.
    await expect(handle.respondPermission('number:65', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses.some((r) => r.id === 65)).toBe(false)
    await handle.respondPermission('number:65', { outcome: 'deny' }) // safe negative still works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 65)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an ABSENT decision list combined with undisplayable permissions still blocks positives (widening must not defeat fail-closed)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The dangerous interaction: an absent list normally widens to the sanctioned STANDARD set
    // (unrestricted), while the undisplayable profile must fail positives closed. Fail-closed wins.
    transport.serverRequest(66, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      // no availableDecisions at all → would otherwise assume the standard four
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            {
              path: { type: 'special', value: { kind: 'unknown', path: '/???', subpath: null } },
              access: 'write',
            },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // ⚑ **487 · NOT the widened standard four** — fail-closed still wins on every positive — and
    // the two refusals, which fail-closed never had a reason to withhold.
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    await expect(handle.respondPermission('number:66', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:66', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 66)).toBe(false) // nothing reached the wire
    await handle.respondPermission('number:66', { outcome: 'cancel' }) // safe negative always works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 66)).toBe(true))
    await handle.close()
    await consumer
  })

  it('a sandbox DENY entry is disclosed as a RESTRICTION, not as a granted path', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(67, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: 'path', path: '/work' }, access: 'write' },
            { path: { type: 'path', path: '/etc' }, access: 'deny' }, // a RESTRICTION
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // `restrict /etc`, never `deny /etc` — the latter reads as a granted path in a list the UI
    // presents as "what accepting opens".
    expect(scopeOf(events).scope.paths).toEqual(['write /work', 'restrict /etc'])
    await handle.close()
    await consumer
  })
})

describe('the approval mode is disclosed on the permission scope (078)', () => {
  it('a card raised in AUTO says the session is unattended', async () => {
    // In `auto` a card is itself an anomaly — so if one surfaces, it must state that everything
    // else in this session is running unprompted.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('go')
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('auto')
    await handle.close()
    await consumer
  })

  it('a card raised in ASK discloses ask — the disclosure is never blank', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('ask')
    await handle.close()
    await consumer
  })
})
