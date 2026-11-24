import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { MAX_PERMISSION_DETAIL_CHARS } from '../src/events'
import { THE_AGENT_ASKS_FOR_ACCESS } from '../src/codex/codex-runtime'
import { FakeTransport, firstOfType, has, startCodexInTurn } from './helpers/fake-codex-transport'

describe('CodexRuntime — user-input requests (007 P2-1)', () => {
  const questionParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_color',
        header: 'Color',
        question: 'pick a color',
        isOther: false,
        isSecret: false,
        options: [{ label: 'blue', description: '' }],
      },
    ],
    autoResolutionMs: null,
  }
  const permParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_2',
    environmentId: null,
    startedAtMs: 0,
    cwd: '/tmp/x',
    reason: 'needs write',
    permissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/tmp/x/out'] } },
  }
  const resultFor = (transport: FakeTransport, id: number) =>
    transport.responses.find((r) => r.id === id)?.result

  it('requestUserInput → user_input_request(questions); answer → answers-by-questionId (no {answer})', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(80, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    // ⛔ **`false`, and MEASURED** (139): `ToolRequestUserInputQuestion` carries no multi-select flag,
    // so a Codex question is single-select and says so — rather than leaving the field absent, which
    // is what a question built before the flag existed looks like.
    // ⚑ **143: `allowOther` is FALSE here, and that is the point of reading it.** This fixture sends
    // `isOther: false`, which the pinned normalizer would never produce for an ordinary question —
    // it forces `is_other = true`. The adapter copies what the REQUEST said rather than what the
    // provider's source code says it will say (086), so a producer that declines the escape gets a
    // card with no free-form field and an answer off the list is refused.
    expect(req.questions).toEqual([
      {
        id: 'q_color',
        prompt: 'pick a color',
        header: 'Color',
        options: [{ label: 'blue' }],
        allowOther: false,
        secret: false,
        multiSelect: false,
      },
    ])
    expect(Object.keys(req)).not.toContain('raw')
    await handle.respondUserInput('number:80', { kind: 'answer', answers: { q_color: 'blue' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 80)).toBe(true))
    expect(resultFor(transport, 80)).toEqual({ answers: { q_color: { answers: ['blue'] } } })
    await handle.close()
    await consumer
  })

  /**
   * **139 · the asymmetry, recorded rather than assumed.**
   *
   * 020's comment says the neutral question is built from Claude `AskUserQuestion` questions *or*
   * Codex `requestUserInput` ones, and 135 is the precedent for measuring each side instead of
   * assuming they mirror: `ToolRequestUserInputQuestion` is `{id, header, question, isOther,
   * isSecret, options}` and has no multi-select flag anywhere. The tempting wrong reading is the
   * ANSWER type — `{answers: Array<string>}`, plural for every question — and a response shape that
   * CAN carry several is not a question that asked for several (035: do not invent a signal the
   * provider does not send).
   *
   * ⚠️ **This test pins what is true today, and names where to change when it stops being.** If
   * Codex grows a multi-select flag, `codexQuestions` is the one line that reads it and this is the
   * assertion that has to move — deliberately, not by a pass-through nobody ruled on.
   */
  it('a Codex question is single-select even when the params carry a flag we do not model', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [{ ...questionParams.questions[0], multiSelect: true }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions[0]?.multiSelect).toBe(false)

    // And the answer still leaves in the protocol's own plural wrapper, one answer inside it — the
    // shape that made the flag look unnecessary and never said anything about the question.
    await handle.respondUserInput('number:88', { kind: 'answer', answers: { q_color: 'blue' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(resultFor(transport, 88)).toEqual({ answers: { q_color: { answers: ['blue'] } } })
    await handle.close()
    await consumer
  })

  it('requestUserInput decline → documented {answers:{}} payload, never a JSON-RPC error', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(81, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:81', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 81)).toBe(true))
    expect(resultFor(transport, 81)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 81)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚠️ a decline’s reason is not sent to Codex: its answer has no place for one', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(181, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:181', { kind: 'reject', reason: 'I do not know' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 181)).toBe(true))
    expect(resultFor(transport, 181)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('permissions requestApproval → user_input_request(permission scope); answer → {permissions,scope}', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(82, 'item/permissions/requestApproval', permParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    expect(req.questions).toEqual([])
    // Access-labelled (039): the UI sees it is a WRITE grant, not just "some path".
    // 🔴 **709 · R44 — the model's `reason` is the AGENT's** (measured: `probe:codex-approval-reason`),
    // so it rides `agentReason`, and nothing carries it without an author.
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs write',
      paths: ['write /tmp/x/out'],
      network: true,
    })
    // ⛔ **…and it is not the headline.** It was: `prompt = reason || …`. The card's headline is this
    // app's own sentence, as the Claude adapter's plan cards are.
    expect(req.prompt).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    expect(
      JSON.stringify({ ...req, permission: { ...req.permission, agentReason: null } }),
    ).not.toContain('needs write')
    expect(Object.keys(req)).not.toContain('raw')
    await handle.respondUserInput('number:82', { kind: 'answer', answers: {} }) // permission grant: no questions to answer
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 82)).toBe(true))
    expect(resultFor(transport, 82)).toEqual({ permissions: permParams.permissions, scope: 'turn' })
    await handle.close()
    await consumer
  })

  it('⛔ 709 · a permissions card’s agent words are CLEANED like a command card’s — and dropped past the ceiling', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/permissions/requestApproval', {
      ...permParams,
      reason: '\u001b[1mneeds\u001b[0m\u202e write\n access',
    })
    transport.serverRequest(89, 'item/permissions/requestApproval', {
      ...permParams,
      itemId: 'it_3',
      reason: 'x'.repeat(MAX_PERMISSION_DETAIL_CHARS + 1),
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    const [cleaned, tooLong] = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'user_input_request' }> =>
        e.type === 'user_input_request',
    )
    expect(cleaned?.permission?.agentReason).toBe('needs write access')
    expect(tooLong?.permission !== undefined && 'agentReason' in tooLong.permission).toBe(false)
    await handle.close()
    await consumer
  })

  it('a permissions request with fileSystem ENTRIES discloses them access-labelled, then grants exactly what was shown (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The reviewer's repro shape: `entries: [{ path: '/etc', access: 'write' }]` — pre-fix the UI
    // displayed NO path while a positive answer echoed the raw grant back to the provider.
    const entryParams = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_9',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs /etc',
      permissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: 'path', path: '/etc' }, access: 'write' },
            {
              path: { type: 'special', value: { kind: 'project_roots', subpath: 'src' } },
              access: 'read',
            },
          ],
        },
      },
    }
    transport.serverRequest(87, 'item/permissions/requestApproval', entryParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    // The UI now SEES the entries (pre-fix: paths: []).
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs /etc',
      paths: ['write /etc', 'read special:project_roots/src'],
      network: false,
    })
    // Everything was displayed, so the CONSTRUCTED grant (047 — never a raw echo) reproduces
    // exactly the disclosed subset.
    await handle.respondUserInput('number:87', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 87)).toBe(true))
    expect(resultFor(transport, 87)).toEqual({
      permissions: entryParams.permissions,
      scope: 'turn',
    })
    await handle.close()
    await consumer
  })

  /**
   * A grant must satisfy the vendored `GrantedPermissionProfile`: its `network`/`fileSystem`
   * sections may be ABSENT or an object — never top-level `null` (unlike the REQUEST type, which
   * permits null). This is the runtime mirror of the `satisfies` guard in the adapter (047).
   */
  const assertConformantGrant = (result: unknown): Record<string, unknown> => {
    const grant = result as { permissions: Record<string, unknown>; scope: string }
    expect(grant.scope).toBe('turn')
    expect(typeof grant.permissions).toBe('object')
    for (const section of ['network', 'fileSystem'] as const) {
      if (section in grant.permissions) {
        // Present ⇒ must be an object, never null (the out-of-contract shape 044 P1-F found).
        expect(grant.permissions[section]).not.toBeNull()
        expect(typeof grant.permissions[section]).toBe('object')
      }
    }
    return grant.permissions
  }

  it('a NULLABLE permissions request yields a conformant grant — null sections omitted, never echoed raw (044 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The reviewer's protocol-valid repro: `network` is top-level null. Pre-fix it was echoed
    // verbatim, producing a response that does NOT satisfy `GrantedPermissionProfile`.
    transport.serverRequest(94, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_n',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs write',
      permissions: { network: null, fileSystem: { read: null, write: ['/tmp/out'] } },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // The write is still disclosed to the user (039 coupling intact).
    expect(firstOfType(events, 'user_input_request').permission).toMatchObject({
      paths: ['write /tmp/out'],
      network: false,
    })

    await handle.respondUserInput('number:94', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 94)).toBe(true))
    const granted = assertConformantGrant(resultFor(transport, 94))
    // The null section is OMITTED (not echoed as null); the requested write is granted.
    expect('network' in granted).toBe(false)
    expect(granted['fileSystem']).toEqual({ read: null, write: ['/tmp/out'] })

    await handle.close()
    await consumer
  })

  it('a FULLY-NULL permissions request yields a conformant grant-nothing (044 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(95, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_nn',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'asks for nothing',
      permissions: { network: null, fileSystem: null },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:95', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 95)).toBe(true))
    // Both sections omitted → an empty (valid) profile, never `{network:null, fileSystem:null}`.
    expect(resultFor(transport, 95)).toEqual({ permissions: {}, scope: 'turn' })
    assertConformantGrant(resultFor(transport, 95))

    await handle.close()
    await consumer
  })

  it('an out-of-spec network `enabled` is granted exactly as it was DISCLOSED (shown == granted)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // `enabled` is `boolean | null` per the generated type; a malformed value must not be able to
    // make the grant say something different from the card the user approved.
    transport.serverRequest(96, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_bad',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'malformed network ask',
      permissions: { network: { enabled: 'yes' }, fileSystem: null },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // The card discloses NO network access…
    expect(firstOfType(events, 'user_input_request').permission?.network).toBe(false)
    await handle.respondUserInput('number:96', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 96)).toBe(true))
    // …so the grant must not say otherwise, and must stay a conformant boolean.
    const granted = assertConformantGrant(resultFor(transport, 96))
    expect(granted['network']).toEqual({ enabled: false })

    await handle.close()
    await consumer
  })

  it('a permissions request the neutral scope cannot display FAILS CLOSED — no raw grant is echoed unseen (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_10',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs something we cannot render',
      permissions: {
        network: { enabled: false },
        // A `special:unknown` path has no truthful display — so accepting must grant NOTHING.
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
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:88', { kind: 'answer', answers: {} }) // a POSITIVE answer…
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    // …yields the documented grant-NOTHING payload, never the raw requested profile.
    expect(resultFor(transport, 88)).toEqual({ permissions: {}, scope: 'turn' })
    expect(JSON.stringify(resultFor(transport, 88))).not.toContain('unknown') // no raw echo
    await handle.close()
    await consumer
  })

  it('permissions decline → documented {permissions:{},scope:"turn"}, never a JSON-RPC error', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(83, 'item/permissions/requestApproval', permParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:83', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 83)).toBe(true))
    expect(resultFor(transport, 83)).toEqual({ permissions: {}, scope: 'turn' })
    expect(transport.errors.some((e) => e.id === 83)).toBe(false)
    await handle.close()
    await consumer
  })

  const multiQuestionParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_a',
        header: 'A',
        question: 'first?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'x', description: '' }],
      },
      {
        id: 'q_b',
        header: 'B',
        question: 'second?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'y', description: '' }],
      },
    ],
    autoResolutionMs: null,
  }

  it('keeps one exact padded choice and one overflow preview in separate native parts', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const padded = '  Keep these spaces  '
    const long = 'v'.repeat(2_001)
    const preview = `${long.slice(0, 2_000)} Read res_fictional for the full answer.`
    const [first, second] = multiQuestionParams.questions
    transport.serverRequest(85, 'item/tool/requestUserInput', {
      ...multiQuestionParams,
      questions: [
        { ...first, options: [{ label: padded, description: '' }] },
        { ...second, isOther: true },
      ],
    })
    await vi.waitFor(has(events, (event) => event.type === 'user_input_request'))
    await expect(
      handle.respondUserInput('number:85', {
        kind: 'answer',
        answers: { q_a: padded, q_b: [long, 'one value too many'] },
      }),
    ).rejects.toThrow(/cannot be forwarded/)
    expect(transport.responses.some((row) => row.id === 85)).toBe(false)
    expect(transport.errors.some((row) => row.id === 85)).toBe(false)

    await handle.respondUserInput('number:85', {
      kind: 'answer',
      answers: { q_a: padded, q_b: [preview] },
    })
    await vi.waitFor(() =>
      expect(resultFor(transport, 85)).toEqual({
        answers: { q_a: { answers: [padded] }, q_b: { answers: [preview] } },
      }),
    )
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **The contract Codex did not keep** (142 §2, from 141 HIGH 2). `permission.ts` has promised
   * since 139 that an answer fails closed on empty, blank and several-for-one; `userInputPayloadFor`
   * checked only that every question id was PRESENT, so every one of these reached the provider.
   * Each is refused ALONE, with the other question answered properly, so no case can pass on
   * another's failure — and each is followed by a good answer to the SAME id, which is what proves
   * a refusal left the request alive rather than burning it.
   */
  const CODEX_UNFORWARDABLE: readonly {
    what: string
    answers: Record<string, string | string[]>
  }[] = [
    { what: 'an empty array', answers: { q_a: [], q_b: 'y' } },
    { what: 'a blank string', answers: { q_a: '   ', q_b: 'y' } },
    { what: 'an array of blanks', answers: { q_a: ['', ' '], q_b: 'y' } },
    {
      what: 'several for a question Codex publishes as single-select',
      answers: { q_a: ['x', 'w'], q_b: 'y' },
    },
    { what: 'a substantively partial answer — present, but empty', answers: { q_a: 'x', q_b: [] } },
    // 143: both questions in this fixture declare `isOther: false`, so a typed answer is one the
    // provider said it would not take. Refused here rather than sent — the flag would be decoration
    // if nothing enforced it, which is precisely how `multiSelect` failed in 139.
    {
      what: 'a value that is not on the list, for a question that takes no other',
      answers: { q_a: 'something I typed', q_b: 'y' },
    },
  ]

  for (const [i, { what, answers }] of CODEX_UNFORWARDABLE.entries()) {
    it(`requestUserInput fails closed on ${what}, and never writes it to the wire`, async () => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      const id = 90 + i
      transport.serverRequest(id, 'item/tool/requestUserInput', multiQuestionParams)
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

      await expect(
        handle.respondUserInput(`number:${id}`, { kind: 'answer', answers }),
      ).rejects.toThrow(/cannot be forwarded/)
      // ⛔ Nothing on the wire — not the bad answer, and not a DECLINE either. A decline would tell
      // the provider the user said no while the host recorded `Answered`: 141's HIGH 1, on the
      // provider it was reported for.
      expect(transport.responses.some((r) => r.id === id)).toBe(false)
      expect(transport.errors.some((e) => e.id === id)).toBe(false)

      await handle.respondUserInput(`number:${id}`, {
        kind: 'answer',
        answers: { q_a: 'x', q_b: 'y' },
      })
      await vi.waitFor(() => expect(transport.responses.some((r) => r.id === id)).toBe(true))
      expect(resultFor(transport, id)).toEqual({
        answers: { q_a: { answers: ['x'] }, q_b: { answers: ['y'] } },
      })
      await handle.close()
      await consumer
    })
  }

  it('an `isOther` question takes the answer that is not on the list, in the provider’s own slot (143)', async () => {
    // ⛔ **141 MEDIUM 1, on the Codex half.** The pinned `0.146.0` spec calls options *"2–3 mutually
    // exclusive choices"*, the client adds a free-form Other, and
    // `normalize_request_user_input_args` forces `is_other = true` on every ordinary question — so
    // in practice EVERY Codex question offers this. BroBot rendered a text field only when the
    // option list was empty, which that normalizer forbids, so the escape was unreachable.
    const otherParams = {
      ...multiQuestionParams,
      questions: multiQuestionParams.questions.map((q) => ({ ...q, isOther: true })),
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(96, 'item/tool/requestUserInput', otherParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions[0]!.allowOther).toBe(true)

    await handle.respondUserInput('number:96', {
      kind: 'answer',
      answers: { q_a: 'neither — the third thing', q_b: 'y' },
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 96)).toBe(true))
    // ⚑ **The SAME slot a label occupies, and that is the provider's shape rather than a loss.**
    // `ToolRequestUserInputAnswer` is `{answers: string[]}` with no field marking a member as
    // freeform, and the pinned app-server test client puts a selected option and a free-form Other
    // response into that one array alike. Unlike Claude there is no `response` to set, so on Codex
    // the distinction exists only where the options are — in `answerToForward`, which is what
    // refused the identical value in the loop above when `isOther` was false.
    expect(resultFor(transport, 96)).toEqual({
      answers: { q_a: { answers: ['neither — the third thing'] }, q_b: { answers: ['y'] } },
    })
    await handle.close()
    await consumer
  })

  it('carries `isSecret` rather than dropping it a second time (143, from 141 §3.1)', async () => {
    // 141: *"not exposed by the ordinary pinned model-tool schema and defaults false"* — so no
    // ordinary question sets it today — and BroBot dropped it anyway, *"leaving a latent masking gap
    // if another valid producer sets it"*. Carried, so the card can mask the field instead of
    // rendering a secret in clear text the first time some producer does send one.
    const secretParams = {
      ...multiQuestionParams,
      questions: [{ ...multiQuestionParams.questions[0]!, isSecret: true, isOther: true }],
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(97, 'item/tool/requestUserInput', secretParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const question = firstOfType(events, 'user_input_request').questions[0]!
    expect(question.secret).toBe(true)
    // The paired negative on the same run: the sibling fixture says `false`, so `true` is being read
    // off the request rather than stamped onto every question.
    expect(multiQuestionParams.questions[0]!.isSecret).toBe(false)
    await handle.respondUserInput('number:97', { kind: 'answer', answers: { q_a: 'hunter2' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 97)).toBe(true))
    await handle.close()
    await consumer
  })

  it('requestUserInput with an INCOMPLETE answer is refused, and the card stays live (033, 142)', async () => {
    // This asserted `{answers:{}}` on the wire — the documented DECLINE payload — for an answer the
    // user did give. The provider heard "declined" and the ledger said "Answered". Refusing leaves
    // the id claimed, so the question can still be answered.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(86, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await expect(
      handle.respondUserInput('number:86', { kind: 'answer', answers: { q_a: 'x' } }), // q_b unanswered
    ).rejects.toThrow(/cannot be forwarded/)
    expect(transport.responses.some((r) => r.id === 86)).toBe(false)
    expect(transport.errors.some((e) => e.id === 86)).toBe(false)
    await handle.close()
    await consumer
  })

  it('a REJECT is still the documented empty payload, and still ends the request (033)', async () => {
    // ⚠️ The paired negative for every refusal above: `{answers:{}}` is not gone, it is what saying
    // NO means. A fix that stopped writing it at all would have broken the safe-decline contract
    // while every "nothing on the wire" assertion above stayed green.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(87, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:87', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 87)).toBe(true))
    expect(resultFor(transport, 87)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('a question id of `__proto__` or `constructor` reaches the provider (146 §2)', async () => {
    // ⛔ **145 HIGH 2, the Codex half.** `ToolRequestUserInputQuestion.id` is an unrestricted
    // `String` in the pinned protocol — validated for options, never for id syntax or reserved
    // names — and `codexAnswers` built its response on an ordinary `{}`. So `answers['__proto__']`
    // set the prototype and the provider received `{answers:{}}`, which is byte for byte the
    // payload `userInputDecline` uses to say NO, while BroBot recorded the question as answered.
    // And `answers['constructor']` read back as the inherited function one layer up, in the card.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(140, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: '__proto__' },
        { ...questionParams.questions[0]!, id: 'constructor', question: 'and again' },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions.map((q) => q.id)).toEqual([
      '__proto__',
      'constructor',
    ])

    // ⚠️ **`JSON.parse`, and the reason is the defect itself.** An object LITERAL written
    // `{__proto__: 'blue'}` is the prototype-setter syntax, so the key never becomes a property and
    // this test would be asserting over an empty map. `JSON.parse` defines rather than assigns —
    // and so does the IPC schema, which is what the renderer's answer really arrives through.
    await handle.respondUserInput('number:140', {
      kind: 'answer',
      answers: JSON.parse('{"__proto__":"blue","constructor":"blue"}') as Record<string, string>,
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 140)).toBe(true))

    // ⛔ Asserted through the OWN properties and the serialisation, because a `toEqual` on a plain
    // object would happily read `__proto__` back off the prototype it had just been assigned into.
    const payload = resultFor(transport, 140) as { answers: Record<string, unknown> }
    expect(Object.getOwnPropertyNames(payload.answers).sort()).toEqual(['__proto__', 'constructor'])
    expect(JSON.stringify(payload)).toBe(
      '{"answers":{"__proto__":{"answers":["blue"]},"constructor":{"answers":["blue"]}}}',
    )
    await handle.close()
    await consumer
  })

  it('two questions with the SAME ID are declined, and never become a card (146 §2)', async () => {
    // ⛔ The provider's response is keyed by question id and nothing upstream enforces uniqueness —
    // `codexQuestions` even falls back to a positional `q{i}`, so `id: "q1"` beside a question with
    // no id at all collides without either being malformed on its face. Two questions sharing one
    // draft key means answering the first fills both and one slot is written twice. Declined where
    // the empty case is declined, for the same reason and by the same route.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(141, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: 'q1' },
        { ...questionParams.questions[0]!, id: undefined, question: 'the second' },
      ],
    })

    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 141)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 141)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 141)).toBe(false)

    // ⚠️ **The paired positive**: the same two questions with distinct ids are an ordinary call.
    transport.serverRequest(142, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: 'q1' },
        { ...questionParams.questions[0]!, id: 'q2', question: 'the second' },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions.map((q) => q.id)).toEqual([
      'q1',
      'q2',
    ])
    await handle.close()
    await consumer
  })

  it('carries a NON-EMPTY option description across this adapter (146 §4.3)', async () => {
    // ⛔ **145 MEDIUM 3: the 24/24 mutation claim did not protect this branch.** Every Codex
    // fixture in this file sends `description: ""`, so deleting the non-empty spread in
    // `codexQuestions` stayed green — M10's one red came from the CLAUDE fixture. The
    // implementation was correct and the PROTECTION was not, which is a different defect and
    // exactly as reportable.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(143, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        {
          id: 'q_env',
          header: 'Env',
          question: 'where should this run?',
          isOther: false,
          isSecret: false,
          options: [
            { label: 'staging', description: 'the shared box, safe to break, rebuilt nightly' },
            { label: 'production', description: '' },
          ],
        },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // The positive and the negative in one shape: a real reason is carried verbatim, and an empty
    // one is DROPPED rather than rendered as a blank line that reads like an empty answer (086).
    expect(firstOfType(events, 'user_input_request').questions[0]!.options).toEqual([
      { label: 'staging', description: 'the shared box, safe to break, rebuilt nightly' },
      { label: 'production' },
    ])
    await handle.close()
    await consumer
  })

  it('a requestUserInput with NO questions is declined, and never becomes a live Approve (064, 142)', async () => {
    // ⛔ **`106` and 141's HIGH 1 in one gesture.** `ToolRequestUserInputParams.questions` is
    // unconstrained, pinned 0.146.0 says *"prefer 1"* rather than enforcing a minimum, and the
    // normalizer vacuously accepts `[]`. `UserInputCard` labels its button on `questions.length`
    // and gates it on `every([])`, which is TRUE — so BroBot drew a live **Approve** on a question
    // card, and pressing it sent the same `{answers:{}}` Codex uses for a decline while the ledger
    // recorded Answered. What it renders now is nothing at all: the malformed call is declined
    // where 064 declines Claude's, before any card exists.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', { questions: [] })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 88)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 88)).toBe(false)

    // ⚠️ **The paired positive, in the same test**: a PERMISSION request legitimately carries no
    // questions, and its Approve means what it says. A guard that keyed on `questions.length` alone
    // would silently stop publishing every exec approval Codex makes.
    transport.serverRequest(89, 'item/permissions/requestApproval', {
      cwd: '/tmp/x',
      reason: 'needs write',
      permissions: { write: ['/tmp/x'] },
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    await handle.close()
    await consumer
  })

  it('two EXPLICIT duplicate ids are declined by the duplicate check alone (150)', async () => {
    // ⛔ **This test exists because 150 nearly made the 146 §2 one stop testing anything.** That one
    // uses `id: 'q1'` beside a question with NO id — and 150's new empty-id check catches exactly
    // that shape too, so with both guards in place deleting the duplicate check would have left it
    // green. A collision where BOTH ids are present and truthy can only be caught by
    // `duplicateAnswerKey`, which is what keeps that guard under test.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(95, 'item/tool/requestUserInput', {
      questions: [
        { id: 'same', question: 'first?', options: [{ label: 'a' }] },
        { id: 'same', question: 'second?', options: [{ label: 'b' }] },
      ],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 95)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 95)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 95)).toBe(false)
    await handle.close()
    await consumer
  })

  it('a question with a MISSING id is declined before publication (150, 148 M5)', async () => {
    // ⛔ **142's defect in a place 142 could not see.** `codexQuestions` maps a missing/empty raw id
    // to a positional `q{i}`; that normalized id passes every check, reaches the card, and
    // `answerToForward` accepts an answer keyed by it — but `codexAnswers` writes only when the
    // ORIGINAL `providerId` is truthy. So the user answers, the payload is `{answers:{}}`, which is
    // byte for byte this provider's DECLINE shape, the request is spent, and the host records
    // `Answered`. A human answer destroyed on the way out, with the ledger claiming it landed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(90, 'item/tool/requestUserInput', {
      questions: [{ question: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 90)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 90)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 90)).toBe(false)

    // ⚠️ **The paired positive**: an EXPLICIT id publishes exactly as it always did. The fix is
    // about an id that cannot be returned, not about questions being harder to ask.
    transport.serverRequest(91, 'item/tool/requestUserInput', {
      questions: [{ id: 'q_real', question: 'Which one?', options: [{ label: 'a' }] }],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    await handle.close()
    await consumer
  })

  it('…and an EMPTY-STRING id is the same defect, declined the same way (150)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(92, 'item/tool/requestUserInput', {
      questions: [{ id: '', question: 'Which one?', options: [{ label: 'a' }] }],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 92)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 92)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('a blank option label NEVER becomes a card on Codex either (150, 148 M6)', async () => {
    // The same dead control, refused by the same route on the other provider — one shared predicate
    // (`unanswerableOptionLabel`) so the two adapters cannot drift on what "unanswerable" means.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(93, 'item/tool/requestUserInput', {
      questions: [
        { id: 'q1', question: 'Which one?', options: [{ label: '   ' }, { label: 'real' }] },
      ],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 93)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 93)).toEqual({ answers: {} })

    // ⚠️ **The paired positive, byte for byte**: meaningful surrounding spaces are a choice somebody
    // wrote, and they are preserved exactly (143/146) rather than trimmed away with the blank one.
    transport.serverRequest(94, 'item/tool/requestUserInput', {
      questions: [
        { id: 'q2', question: 'Which one?', options: [{ label: ' spaced ' }, { label: 'real' }] },
      ],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    const published = events.filter((e) => e.type === 'user_input_request')[0]!
    expect(published.questions[0]!.options).toEqual([{ label: ' spaced ' }, { label: 'real' }])
    await handle.close()
    await consumer
  })
})
