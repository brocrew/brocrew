import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { createSessionStore, overTheWire } from '../src/renderer/src/lib/session-store'
import type { OutgoingQuestion, TranscriptState } from '../src/renderer/src/lib/transcript'
import { WINDOW_MAX_EVENTS } from '../src/renderer/src/lib/transcript-window'
import type {
  AnswerAck,
  ResumedSession,
  FirstMessageAnswer,
  FirstMessageNotSent,
} from '../src/shared/runtime-ipc'
import { fakeBridge, hello } from './lib/session-store-double'

/**
 * ⛔ **The killer for the clone `361` added to {@link throughTheWire}** — without it that clone is a
 * line no mutation can make red, because every store test in this file builds its payloads out of
 * literals and a literal survives any wire.
 *
 * ⚑ **Both halves, one fact apart.** The same three fields, reached the way `218` reached them (out
 * of a `reactive` map) and then copied, so what is being measured is the PAYLOAD rather than the
 * wrapper's willingness to refuse things.
 */
describe('the double refuses what the wire refuses (361 §2)', () => {
  const asBook = (): Map<string, { path: string; kind: 'file'; outsideCwd: boolean }> =>
    reactive(new Map([['/a', { path: '/a', kind: 'file' as const, outsideCwd: false }]]))

  /**
   * ⛔ **At the BRIDGE and not through `store.send`, and that is not a shortcut.** `218`'s fix lives
   * in `store.send`, which calls {@link overTheWire} on the way past — so a payload driven through
   * the store is plain by the time the double sees it, and this assertion could never go red there.
   * The proxy has to be put where `ipcRenderer.invoke` would meet it.
   */
  it('🔴 a send whose attachments are still proxies is rejected, not recorded', async () => {
    const bridge = fakeBridge()

    await expect(
      bridge.send({ sessionId: 's1', text: 'read this', attachments: [...asBook().values()] }),
    ).rejects.toThrow(/would not survive ipcRenderer\.invoke/)
    expect(bridge.__inputs).toEqual([])
  })

  it('⚑ …and the same send with `overTheWire`’s copy is delivered', async () => {
    const bridge = fakeBridge()

    await bridge.send({
      sessionId: 's1',
      text: 'read this',
      attachments: overTheWire([...asBook().values()]),
    })
    expect(bridge.__inputs).toEqual([
      {
        sessionId: 's1',
        text: 'read this',
        attachments: [{ path: '/a', kind: 'file', outsideCwd: false }],
      },
    ])
  })
})

/**
 * 🔴 **737 · `730` F-7 — `busy` is lowered by the LAST command to settle, never by the first** — ⚠️
 * or, since `739` (`737` F-6), by the bound of one that has had no answer
 * (`A_COMMAND_IS_WAITED_ON_MS`, 15 s): each command counts until it answers or its bound passes. The
 * Stops below all settle inside their bounds; past it is `a-command-that-has-no-answer.test.ts`.
 *
 * ⛔ **It was a boolean**, flipped on and off by every command that goes through the store's
 * `forSession`. Two commands for one conversation can be out at once — a second Stop pressed while
 * the first still waits, which the host joins to the standing ask and answers under its own bound
 * (`RuntimeHost.interrupt`, R83) — and whichever settled first lowered `busy` under the other. ⚑ What
 * a person saw: Leave planning (`plan-leave-button`) and the sign-in remedy lit again while a
 * command for the conversation was still out.
 */
describe('🔴 737 · `730` F-7 — `busy` counts the commands that are out, each until it answers or its bound (`A_COMMAND_IS_WAITED_ON_MS`) passes', () => {
  /** A bridge whose Stops wait until the test answers them, in any order. */
  function stopsThatWait() {
    const bridge = fakeBridge()
    const answers: { resolve: () => void; reject: (cause: Error) => void }[] = []
    bridge.interrupt = () =>
      new Promise<void>((resolve, reject) => void answers.push({ resolve, reject }))
    return { bridge, answers }
  }

  it('⚑ the control: one Stop raises it while it is out and lowers it when it settles', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)
    expect(record?.busy, 'nothing is out yet').toBe(false)

    const stop = store.interrupt(id)
    expect(record?.busy, 'the Stop is out').toBe(true)
    answers[0]?.resolve()
    await stop
    expect(record?.busy, 'nothing is out any more').toBe(false)
    store.dispose()
  })

  it('🔴 two Stops out at once: the FIRST to settle leaves it up while the second still waits', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)

    const first = store.interrupt(id)
    const second = store.interrupt(id)
    expect(answers, 'both presses reached the host').toHaveLength(2)

    answers[0]?.resolve()
    await first
    expect(record?.busy, 'the second Stop is still out, so the conversation is still busy').toBe(
      true,
    )

    answers[1]?.resolve()
    await second
    expect(record?.busy, 'the last one settled').toBe(false)
    store.dispose()
  })

  it('🔴 …and in the other order, and a command that FAILS counts down as one that answers', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)

    const first = store.interrupt(id)
    const second = store.interrupt(id)
    answers[1]?.reject(new Error("Error invoking remote method 'x': Error: nope"))
    await second
    expect(record?.error, 'the failure is said beside the conversation').toBe('nope')
    expect(record?.busy, 'the first Stop is still out').toBe(true)

    answers[0]?.resolve()
    await first
    expect(record?.busy).toBe(false)
    store.dispose()
  })
})

/**
 * 🔴 **737 · `735` §3 — the store's door for a first message and its start, in ONE act.**
 *
 * ⚑ `store.startAndSend` asks the host's `startAndSend` under the conversation's own launch name, so
 * the pane's Cancel reaches it, and adopts what the host hands over exactly as a reopen does:
 *  - `sent` → adopted; the words are NOT sent again;
 *  - `notSent` with `running` (`735` F-1: the start was kept) → adopted, and the host's sentence is
 *    said beside that conversation (`record.error`);
 *  - `notSent` with nothing running (a Cancel is one: the host ANSWERS it), or a rejection → no
 *    record is left for the list.
 *
 * ⚠️ **A new door**: on `main` the store has no `startAndSend`, so these fail there by a TypeError —
 * they pin the door, and draw 1's RED on `main` is measured through the real host in
 * `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts` §1.
 */
describe('🔴 737 · `store.startAndSend` — the first message and its start, in one act', () => {
  const refused = (over: Partial<FirstMessageNotSent['notSent']> = {}): FirstMessageAnswer => ({
    notSent: {
      refusedBy: 'after-the-start',
      said: 'A command with a file attached is not sent.',
      launch: null,
      running: null,
      ...over,
    },
  })

  it('⚑ sent: ONE command, adopted here, and nothing sent a second time', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const came = await store.startAndSend('sess_kept', 'where were we', [])
    expect(came).toEqual({ sent: true, openHere: true })
    expect(store.isLive('sess_kept')).toBe(true)
    expect(bridge.__calls.filter((call) => /^(startAndSend|resume|send):/.test(call))).toEqual([
      'startAndSend:sess_kept',
    ])
    store.dispose()
  })

  it('🔴 `735` F-5 — the attachments cross as a PLAIN copy, never the composer’s reactive array', async () => {
    // ⛔ The fake clones as the wire does (`throughTheWire`), so a `Proxy` handed over throws here.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const staged = reactive([
      { path: '/work/sess_kept/notes.md', kind: 'file' as const, outsideCwd: false },
    ])
    await expect(store.startAndSend('sess_kept', 'look', staged)).resolves.toEqual({
      sent: true,
      openHere: true,
    })
    expect(bridge.__inputs.at(-1)?.attachments).toEqual([
      { path: '/work/sess_kept/notes.md', kind: 'file', outsideCwd: false },
    ])
    store.dispose()
  })

  it('🔴 `735` F-1 — a start KEPT and handed over running is adopted, and the host’s sentence is said beside it', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const running: ResumedSession = {
      ...(await bridge.resume({ sessionId: 'sess_kept' })),
      handover: 'resumed',
    }
    const said =
      'Another message reached it first. It had been started for this message, and it is running now.'
    bridge.startAndSend = async () => refused({ said, running })
    const came = await store.startAndSend('sess_kept', 'hi', [])
    expect(came).toMatchObject({ sent: false, openHere: true })
    expect(store.isLive('sess_kept')).toBe(true)
    expect(store.get('sess_kept')?.error).toBe(said)
    store.dispose()
  })

  it('⚑ …and one fact over: refused with nothing running — no record is left for the list, nothing said on one', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.startAndSend = async () => refused()
    const came = await store.startAndSend('sess_kept', '/usage', [])
    expect(came).toMatchObject({ sent: false, openHere: false })
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('⚑ a REJECTION (the wire’s own refusal) is no answer: `null`, its sentence on `resumeError`, no record', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.startAndSend = () =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: the app is quitting"))
    await expect(store.startAndSend('sess_kept', 'hi', [])).resolves.toBeNull()
    expect(store.resumeError.value).toBe('the app is quitting')
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('🔴 737 review · an ask about ANOTHER session mid-start does not adopt this one early — an undone start leaves no record', async () => {
    // ⛔ `askAboutUnknown`'s own guard is keyed on the event's session: an event for some OTHER
    // unknown conversation asked the host for every open one, the host named this one (registered to
    // this window mid-start), and it was adopted before the answer — so an undone start left a
    // record behind for a conversation still open with nothing running.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    let answer!: (came: FirstMessageAnswer) => void
    bridge.startAndSend = () => new Promise<FirstMessageAnswer>((resolve) => (answer = resolve))
    const pending = store.startAndSend('sess_kept', '/usage', [])
    bridge.__held.add('sess_kept')
    bridge.__emit('sess_other', 0, hello('a conversation this window has never heard of'))
    for (let tick = 0; tick < 100 && !bridge.__calls.includes('attachOpen'); tick++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(bridge.__calls, 'the premise: the other session made the store ask the host').toContain(
      'attachOpen',
    )
    // ⚑ Let the host's answer land and every adoption it would make run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.isLive('sess_kept'), 'adopted by an ask about another session').toBe(false)
    bridge.__held.delete('sess_kept')
    answer(refused())
    await expect(pending).resolves.toMatchObject({ sent: false, openHere: false })
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('🔴 the pane’s Cancel REACHES the start — it is named under the conversation’s own id', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    let answer!: (came: FirstMessageAnswer) => void
    bridge.startAndSend = (input) => {
      bridge.__inputs.push(input)
      return new Promise<FirstMessageAnswer>((resolve) => (answer = resolve))
    }
    const pending = store.startAndSend('sess_kept', 'hi', [])
    expect(store.isLaunching('sess_kept'), 'the start is named under its own id').toBe(true)
    const key = (bridge.__inputs.at(-1) as { launchKey?: string }).launchKey
    expect(key, 'a launch key crossed with it').toBeTypeOf('string')
    await store.cancelLaunch('sess_kept')
    expect(bridge.__calls).toContain(`cancelLaunch:${key}`)
    // ⚑ The host answers a cancelled start (`the-start`, `cancelled`) — an answer, not a rejection.
    answer(refused({ refusedBy: 'the-start', said: 'Cancelled.', launch: 'cancelled' }))
    await expect(pending).resolves.toMatchObject({ sent: false, openHere: false })
    store.dispose()
  })
})

/**
 * A person's answer to a to-do goes through the store, and the store alone settles its card.
 *
 * The host answers `taken`, or `refused` with whether the to-do is still open. Only a refusal that
 * leaves it closed settles the card, in the host's words, on both folds: the reading fold and the
 * control fold are different objects while a reader pages back, and a card settled on one only
 * would stay live on the other.
 */
describe('a to-do answered through the store', () => {
  const TODO = 'Check the sample report and confirm its title.'
  const toDo: TranscriptEvent[] = [
    {
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        tools: [{ name: 'request_action', description: '', parameters: [] }],
      },
      published: null,
    } as unknown as TranscriptEvent,
    {
      type: 'tool_call',
      id: 'call_report',
      name: 'mcp__brobot__request_action',
      summary: JSON.stringify({ action: TODO }),
    } as TranscriptEvent,
    {
      type: 'question_asked',
      requestId: 'req_report',
      piece: 'work_report',
      label: 'W3.4',
      prompt: TODO,
      questions: [],
      action: { files: [] },
    } as TranscriptEvent,
    { type: 'request_routed', requestId: 'req_report', to: 'a-person' } as TranscriptEvent,
  ]

  const card = (fold: TranscriptState): OutgoingQuestion | null => {
    for (const item of fold.items) {
      if (item.kind !== 'tool' || item.outgoing?.tool !== 'request_action') continue
      if (item.outgoing.asked?.requestId === 'req_report') return item.outgoing.asked
    }
    return null
  }

  /** A conversation holding the to-do, its reading fold split from its control fold. */
  async function holding(bridge: ReturnType<typeof fakeBridge>) {
    const store = createSessionStore(bridge)
    const id = 'sess_report'
    bridge.__history.set(
      id,
      toDo.map((event, index) => ({ ordinal: WINDOW_MAX_EVENTS + index, at: 1_000, event })),
    )
    const claim = bridge.claim
    bridge.claim = async (input) => {
      const answer = await claim(input)
      return { ...answer, history: { ...answer.history, hasOlder: true } }
    }
    await store.claim(id)
    bridge.__history.set(
      id,
      Array.from({ length: WINDOW_MAX_EVENTS }, (_, ordinal) => ({
        ordinal,
        at: 1_000,
        event: toDo[ordinal] ?? hello('earlier words'),
      })),
    )
    await store.loadOlder(id)
    const record = store.get(id)!
    expect(record.control).not.toBe(record.transcript)
    expect(card(record.transcript)).not.toBeNull()
    expect(card(record.control)).not.toBeNull()
    return { store, id, record }
  }

  it('a refusal that closes the to-do settles its card on both folds, in the host’s words', async () => {
    const bridge = fakeBridge()
    const asked: unknown[] = []
    bridge.answerAction = async (input) => {
      asked.push(input)
      return { outcome: 'refused', reason: 'This to-do was already answered.', stillOpen: false }
    }
    const { store, id, record } = await holding(bridge)

    const ack = await store.answerAction(id, 'req_report', false, 'I cannot open it.')

    expect(asked).toEqual([
      { sessionId: id, request: 'req_report', done: false, note: 'I cannot open it.' },
    ])
    expect(ack).toEqual({
      outcome: 'refused',
      reason: 'This to-do was already answered.',
      stillOpen: false,
    })
    expect(card(record.transcript)?.note).toBe('This to-do was already answered.')
    expect(card(record.control)?.note).toBe('This to-do was already answered.')
    store.dispose()
  })

  it('a taken answer, a refusal that leaves it open and a thrown call leave the card live', async () => {
    const answers: (() => Promise<AnswerAck>)[] = [
      async () => ({ outcome: 'taken' }),
      async () => ({ outcome: 'refused', reason: 'Try again.', stillOpen: true }),
      async () => {
        throw new Error('the bridge is gone')
      },
    ]
    for (const answer of answers) {
      const bridge = fakeBridge()
      bridge.answerAction = answer
      const { store, id, record } = await holding(bridge)

      await store.answerAction(id, 'req_report', true, '').catch(() => undefined)

      expect(card(record.transcript)?.note).toBeUndefined()
      expect(card(record.control)?.note).toBeUndefined()
      store.dispose()
    }
  })

  it('sends no empty note, and a thrown call reaches the caller', async () => {
    const bridge = fakeBridge()
    const asked: unknown[] = []
    bridge.answerAction = async (input) => {
      asked.push(input)
      throw new Error('the bridge is gone')
    }
    const { store, id } = await holding(bridge)

    await expect(store.answerAction(id, 'req_report', true, '')).rejects.toThrow(
      'the bridge is gone',
    )
    expect(asked).toEqual([{ sessionId: id, request: 'req_report', done: true }])
    store.dispose()
  })

  it('asks the host for a conversation this window does not hold', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    expect(await store.answerAction('sess_elsewhere', 'req_report', true, '')).toEqual({
      outcome: 'taken',
    })
    expect(bridge.__calls).toContain('answerAction:sess_elsewhere')
    store.dispose()
  })
})
