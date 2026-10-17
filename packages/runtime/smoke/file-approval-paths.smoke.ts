import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
  type TransportFactory,
} from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * **Does the file-change approval's item already carry its paths WHEN THE CARD GOES UP?** (181 §1)
 *
 * `pnpm run probe:file-approval-paths`.
 *
 * The report: a live Codex conversation whose write card read `apply_patch` / `file` and named no
 * file, beside a Changes tab that later said *"they arrive on the change item, not on the
 * approval."* `FileChangeRequestApprovalParams` genuinely carries no paths — `{threadId, turnId,
 * itemId, startedAtMs, reason?, grantRoot?}` — so the card is not dropping something it was handed.
 * The open question is the OTHER end of the correlation: `ThreadItem.fileChange` carries
 * `changes: FileUpdateChange[]` under the same `itemId`, and the PM saw the change item in the
 * transcript **before** the card.
 *
 * ⚠️ **This is a measurement and it is deliberately not reasoned from the types.** 096 already
 * measured that `item/fileChange/patchUpdated` — the notification 092 designed the whole pane on —
 * has never arrived once in 458,200 frames. A type that declares `changes` says nothing about
 * whether the array is populated at `item/started`, and that is the only fact that decides whether
 * 071's *"show the whole command"* can apply to a file change at all.
 *
 * So this tees the WIRE: every notification and server request, in arrival order, with a sequence
 * number. At the instant each approval card is published it snapshots what the app has already been
 * told about that `itemId`, then keeps watching so the report can say when the paths DID arrive.
 *
 * ⛔ It asserts only that it captured a file approval at all (168: absence in a capture is not
 * absence — a run that never got a card measures nothing, and must fail rather than report "no").
 * Both answers to the actual question are REPORTED, neither is a failure.
 *
 * ## ⛔ 184 · the second question, on the same wire
 *
 * 181 correlated the item to the approval by `itemId` **alone**, and 182 H3 found that nothing —
 * no generated type, no comment — promises an item id is unique beyond its turn. The fix keys the
 * tracker on `(threadId, turnId, itemId)`, which is sound only if the frame that NAMES the paths
 * declares the same thread and turn the approval declares. That is a fact about the wire, not about
 * the types, so this run now tees both ids on every frame and prints a MATCH/MISMATCH verdict per
 * approval. ⚠️ **A three-field key that misses would silently return the card to `apply_patch ·
 * file`** — the exact regression shape 183 shipped and had to measure its way back out of.
 *
 * 🔒 A throwaway provider home under `tmpdir()`, a throwaway git repo, and the run FAILS if anything
 * it owns turns up in `~/.claude` or `~/.codex` (176's guard).
 */

/** One incoming wire message, stamped with its arrival order. */
type Frame = CodexIncoming & { seq: number; at: number }

/** What the app had been told about an item's changes at the moment a card went up. */
interface Snapshot {
  readonly approvalSeq: number
  readonly itemId: string
  readonly reason: string | undefined
  /** ⛔ 184 · the OTHER two identities the approval declares, which 181 correlated on neither. */
  readonly threadId: string | undefined
  readonly turnId: string | undefined
  /** Frames naming this itemId that arrived BEFORE the approval request, in order. */
  readonly before: {
    seq: number
    method: string
    changes: number | null
    threadId: string | undefined
    turnId: string | undefined
  }[]
  /** The first frame naming this itemId with a NON-EMPTY changes array, whenever it arrived. */
  readonly firstWithPaths: { seq: number; method: string; paths: string[] } | null
  /**
   * ⛔ **184 · what the CARD said**, captured at the instant it was published.
   *
   * The other fields measure the wire; this one measures the app's answer to it, so the correlation
   * is checked end to end rather than inferred from the two halves separately.
   */
  readonly card: { detail: string; paths: readonly string[]; underDisclosed: boolean }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * ⛔ **184 · the thread and turn a frame declares, or `undefined` where it declares neither.**
 *
 * `undefined` and `''` are different answers and the 184 question turns on it: a frame with no
 * `threadId` FIELD never claimed one, and a key built from the frame's own strings would then be
 * built from an empty string while the approval's is the session's thread. The vendored types
 * declare both required on `ItemStartedNotification`, `ItemCompletedNotification`,
 * `FileChangePatchUpdatedNotification` **and** `FileChangeRequestApprovalParams` — this reads the
 * wire instead of the type, because 168's rule cuts both ways.
 */
function identityOf(params: unknown): { threadId: string | undefined; turnId: string | undefined } {
  if (!isRecord(params)) return { threadId: undefined, turnId: undefined }
  const threadId = params['threadId']
  const turnId = params['turnId']
  return {
    threadId: typeof threadId === 'string' ? threadId : undefined,
    turnId: typeof turnId === 'string' ? turnId : undefined,
  }
}

/** The `itemId` a frame is about, however this method spells it. */
function itemIdOf(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  const direct = params['itemId']
  if (typeof direct === 'string') return direct
  const item = params['item']
  if (isRecord(item) && typeof item['id'] === 'string') return item['id']
  return undefined
}

/**
 * The `changes` array a frame carries for a file change, or `null` when it carries no such field.
 *
 * ⚠️ **`null` and `[]` are different answers and the whole measurement turns on it**: a frame with
 * no `changes` field never claimed to have any, while `changes: []` is the provider saying this
 * item has no paths yet. Collapsing them would make "the item arrives empty" — §1b's case —
 * indistinguishable from "this frame is not about a file change".
 */
function changesOf(params: unknown): { path: string; kind: string }[] | null {
  if (!isRecord(params)) return null
  const holder = isRecord(params['item']) ? (params['item'] as Record<string, unknown>) : params
  if (holder !== params && holder['type'] !== 'fileChange') return null
  const raw = holder['changes']
  if (!Array.isArray(raw)) return null
  return raw.map((change) => ({
    path: isRecord(change) && typeof change['path'] === 'string' ? change['path'] : '(no path)',
    kind:
      isRecord(change) && isRecord(change['kind']) && typeof change['kind']['type'] === 'string'
        ? (change['kind']['type'] as string)
        : '(no kind)',
  }))
}

/**
 * The real transport with every incoming frame copied into `sink` on the way past.
 *
 * A Proxy rather than a hand-written delegate: {@link CodexTransport} carries an optional `pid`
 * accessor the host reads to describe the provider process, and a delegate that forgot it would
 * change the thing being measured. Only `incoming()` is intercepted.
 */
function teeing(inner: TransportFactory, sink: Frame[]): TransportFactory {
  return (context) => {
    const transport = inner(context)
    return new Proxy(transport, {
      get(target, prop) {
        if (prop === 'incoming') {
          return (): AsyncIterable<CodexIncoming> => ({
            async *[Symbol.asyncIterator](): AsyncGenerator<CodexIncoming> {
              for await (const message of target.incoming()) {
                sink.push({ ...message, seq: sink.length + 1, at: Date.now() })
                yield message
              }
            },
          })
        }
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as CodexTransport
  }
}

/**
 * ⛔ **184 · would a `(threadId, turnId, itemId)` key find the entry that named these paths?**
 *
 * `MATCH` needs **at least one** naming frame carrying both ids, non-empty and equal to the
 * approval's. `UNDECIDED` is its own answer rather than a pass: a run where nothing named a path in
 * time measures §1b, not this (168 — a capture that did not see the thing testifies to nothing).
 *
 * ⚠️ **`some`, not `every`, and the difference is the whole point of the verdict.** A run in which a
 * FOREIGN frame also reuses the item id is the 182 H3 scenario itself — the one where the card must
 * still name the right file. Requiring every naming frame to match would call that run `MISMATCH`
 * and skip the assertion below, so the probe would stop checking in exactly the case it exists for.
 */
function verdictOf(snapshot: Snapshot): 'MATCH' | 'MISMATCH' | 'UNDECIDED' {
  const naming = snapshot.before.filter((f) => (f.changes ?? 0) > 0)
  if (naming.length === 0) return 'UNDECIDED'
  return naming.some(
    (f) =>
      f.threadId !== undefined &&
      f.threadId !== '' &&
      f.threadId === snapshot.threadId &&
      f.turnId !== undefined &&
      f.turnId !== '' &&
      f.turnId === snapshot.turnId,
  )
    ? 'MATCH'
    : 'MISMATCH'
}

function perms(events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'permission_request' }>[] {
  return events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
      e.type === 'permission_request',
  )
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

it('181 · what the app knows about a file change when it asks you to approve it', async () => {
  const scratch = join(tmpdir(), `brobot2-file-approval-paths-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  // A git repo with a committed file, so the run can measure an ADD and a MODIFY — the two shapes
  // a `PatchChangeKind` distinguishes, and the second one cannot be produced without a base file.
  execFileSync('git', ['init', '-q'], { cwd: scratch })
  execFileSync('git', ['config', 'user.email', 'probe@example.invalid'], { cwd: scratch })
  execFileSync('git', ['config', 'user.name', 'probe'], { cwd: scratch })
  writeFileSync(join(scratch, 'existing.txt'), 'alpha\nbeta\ngamma\n')
  execFileSync('git', ['add', '-A'], { cwd: scratch })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: scratch })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-approval-paths-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const frames: Frame[] = []
  const runtime = new CodexRuntime(teeing(bundledCodexTransportFactory(), frames), codexAuthHealth)
  // ⛔ `ask`, not `auto`: this probe exists to watch the approval gate, and yolo has no cards.
  const handle = await runtime.start({ cwd: scratch, providerHome, approvalMode: 'ask' })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)
  const snapshots: Snapshot[] = []
  let turnsAsked = 0

  /** Ask for one edit, snapshot every card it raises at the instant it is published, approve, wait. */
  async function editTurn(ask: string): Promise<void> {
    turnsAsked += 1
    const turnsBefore = events.filter((e) => e.type === 'turn').length
    let answered = perms(events).length
    await handle.send(ask)
    for (;;) {
      await waitFor(
        () =>
          events.filter((e) => e.type === 'turn').length > turnsBefore ||
          perms(events).length > answered,
        300_000,
        'a card or the end of the turn',
      )
      if (events.filter((e) => e.type === 'turn').length > turnsBefore) return
      const card = perms(events)[answered]!
      // ⛔ **Snapshot BEFORE answering.** The whole question is what the app held at the moment the
      // user was asked, and approving is what makes the patch apply and the paths arrive.
      if (card.kind === 'file') {
        // ⛔ **The frame THIS card came from, by request id — not the newest one on the wire** (184).
        // The card's id is `${typeof id}:${id}` (045's type-preserving `requestKey`), so the two can
        // be matched exactly. `.at(-1)` was close enough while this only labelled a console line;
        // with an assertion hanging off the verdict, two approvals in flight would let the identity
        // of one be checked against the disclosure of the other, in either direction.
        const approval = frames.find(
          (f) =>
            f.kind === 'request' &&
            f.method === 'item/fileChange/requestApproval' &&
            `${typeof f.id}:${String(f.id)}` === card.id,
        )
        const itemId = itemIdOf(approval?.params) ?? '(none)'
        const approvalSeq = approval?.seq ?? -1
        snapshots.push({
          approvalSeq,
          itemId,
          reason:
            isRecord(approval?.params) && typeof approval.params['reason'] === 'string'
              ? approval.params['reason']
              : undefined,
          ...identityOf(approval?.params),
          before: frames
            .filter((f) => f.seq < approvalSeq && itemIdOf(f.params) === itemId)
            .map((f) => ({
              seq: f.seq,
              method: f.method,
              changes: changesOf(f.params)?.length ?? null,
              ...identityOf(f.params),
            })),
          firstWithPaths: null,
          card: {
            detail: card.detail,
            paths: card.scope.paths,
            underDisclosed: card.scope.underDisclosed,
          },
        })
      }
      await handle.respondPermission(card.id, {
        outcome: card.scope.availableDecisions.includes('allow') ? 'allow' : 'deny',
      })
      answered += 1
    }
  }

  try {
    await editTurn(
      `Create a file at the absolute path ${join(scratch, 'written.txt')} containing exactly ` +
        `HELLO using a single file write. Do not read it back and do not run any command. Then stop.`,
    )
    await editTurn(
      `Edit the file at the absolute path ${join(scratch, 'existing.txt')} so the line beta reads ` +
        `BETA instead. Use a single file edit, do not read it back afterwards and do not run any ` +
        `command. Then stop.`,
    )

    // ── the report ────────────────────────────────────────────────────────────────────────────
    const fileApprovals = frames.filter(
      (f) => f.kind === 'request' && f.method === 'item/fileChange/requestApproval',
    )
    console.log(
      [
        '\n── 181 §1 · what the app held when it asked ──',
        `  turns asked          : ${turnsAsked}`,
        `  frames captured      : ${frames.length}`,
        `  file approvals       : ${fileApprovals.length}`,
        `  command approvals    : ${frames.filter((f) => f.kind === 'request' && f.method === 'item/commandExecution/requestApproval').length}`,
        `  cards published      : ${perms(events).length} (${perms(events).filter((p) => p.kind === 'file').length} file)`,
      ].join('\n'),
    )

    for (const snapshot of snapshots) {
      // Filled in AFTER the turn, so the report can say when the paths did arrive if they were not
      // there in time — which is the difference between §1 and §1b.
      const withPaths = frames.find((f) => {
        if (itemIdOf(f.params) !== snapshot.itemId) return false
        const changes = changesOf(f.params)
        return changes !== null && changes.length > 0
      })
      const changes = withPaths ? (changesOf(withPaths.params) ?? []) : []
      console.log(
        [
          `\n  ── approval #${snapshot.approvalSeq} · item ${snapshot.itemId} ──`,
          `     reason on the approval : ${snapshot.reason ?? '(none)'}`,
          // ⛔ 184 · the two identities 181 did not correlate on. A key of three fields is sound only
          // if the item that NAMED the paths declares the same pair the approval does.
          `     approval threadId      : ${snapshot.threadId ?? '(no such field)'}`,
          `     approval turnId        : ${snapshot.turnId ?? '(no such field)'}`,
          `     frames about this item BEFORE the approval:`,
          ...(snapshot.before.length === 0
            ? ['       (none — the card is the first the app hears of this item)']
            : snapshot.before.map(
                (f) =>
                  `       #${f.seq} ${f.method} · changes: ${f.changes === null ? '(no such field)' : f.changes}` +
                  ` · threadId ${f.threadId ?? '(none)'} ${f.threadId === snapshot.threadId ? '==' : '!='} approval` +
                  ` · turnId ${f.turnId ?? '(none)'} ${f.turnId === snapshot.turnId ? '==' : '!='} approval`,
              )),
          `     first frame carrying paths for it : ${
            withPaths
              ? `#${withPaths.seq} ${withPaths.method} — ${changes.map((c) => `${c.kind} ${c.path}`).join(', ')}`
              : '(never, in this capture)'
          }`,
          `     …and that was ${
            withPaths
              ? withPaths.seq < snapshot.approvalSeq
                ? `BEFORE the approval (by ${snapshot.approvalSeq - withPaths.seq} frames)`
                : `AFTER the approval (by ${withPaths.seq - snapshot.approvalSeq} frames)`
              : 'never'
          }`,
        ].join('\n'),
      )
    }

    // ── ⛔ 184 · is a three-field key sound? ────────────────────────────────────────────────────
    //
    // The verdict this run exists to add: for every approval, did the frame that actually NAMED the
    // paths declare the same `(threadId, turnId)` the approval declares? If it did not, keying the
    // tracker on all three would silently stop naming files — 181's whole win — and the narrower key
    // would need a different justification.
    console.log('\n── 184 · does the naming frame carry the approval’s own thread and turn? ──')
    for (const snapshot of snapshots) {
      const naming = snapshot.before.filter((f) => (f.changes ?? 0) > 0)
      console.log(
        [
          `  item ${snapshot.itemId}`,
          `    approval  : threadId ${snapshot.threadId ?? '(none)'} · turnId ${snapshot.turnId ?? '(none)'}`,
          ...(naming.length === 0
            ? ['    naming    : (no frame named a path before the approval)']
            : naming.map(
                (f) =>
                  `    naming    : #${f.seq} ${f.method} · threadId ${f.threadId ?? '(none)'} · turnId ${f.turnId ?? '(none)'}`,
              )),
          `    VERDICT   : ${verdictOf(snapshot)}`,
          // The app's own answer, so the two halves are never reconciled by eye.
          `    the card  : underDisclosed ${snapshot.card.underDisclosed} · paths [${snapshot.card.paths.join(', ')}]`,
          `                ${snapshot.card.detail.replace(/\n/g, '\n                ')}`,
        ].join('\n'),
      )
    }

    // Every frame in order, so the next reader re-decides from the wire rather than from this file.
    console.log('\n── every frame, in arrival order ──')
    for (const frame of frames) {
      const id = itemIdOf(frame.params)
      const changes = changesOf(frame.params)
      const identity = identityOf(frame.params)
      console.log(
        `  #${String(frame.seq).padStart(3)} ${frame.kind === 'request' ? 'REQ ' : '    '}` +
          `${frame.method}${id ? ` · ${id}` : ''}` +
          `${identity.threadId === undefined && identity.turnId === undefined ? '' : ` · thread ${identity.threadId ?? '(none)'} · turn ${identity.turnId ?? '(none)'}`}` +
          `${changes === null ? '' : ` · changes[${changes.length}]${changes.length ? `: ${changes.map((c) => `${c.kind} ${c.path}`).join(', ')}` : ''}`}`,
      )
    }

    // 🔒 nothing of ours in a personal home (176)
    const markers: Marker[] = [
      { label: 'our home', value: `codex-approval-paths-${process.pid}` },
      { label: 'our cwd', value: `brobot2-file-approval-paths-${process.pid}` },
    ]
    // ⛔ See `model-effort-probe.smoke.ts` — the spread threw until 202 corrected the declaration.
    expect(
      describeScan(
        pathsNaming(join(homedir(), '.claude'), markers),
        pathsNaming(join(homedir(), '.codex'), markers),
      ),
      'nothing this run made is in a personal home',
    ).toBe('none')

    // ⛔ The only unconditional assertion: this run actually saw the thing it is about. A capture
    // with no file approval in it cannot testify that the paths are absent (168).
    expect(
      snapshots.length,
      'the run captured at least one file-change approval — otherwise it measures nothing',
    ).toBeGreaterThan(0)

    // ⛔ **184 · the correlation, end to end, and CONDITIONAL on the wire having supplied it.**
    //
    // ⚠️ It cannot fail spuriously and that is deliberate: it fires only for an approval whose own
    // capture shows a naming frame carrying the same thread and turn, which is precisely the case
    // where the key MUST find the entry. §1b's honest silence — the provider named nothing in time —
    // reads as `UNDECIDED` and asserts nothing, because there a blank card is the correct card.
    for (const snapshot of snapshots.filter((s) => verdictOf(s) === 'MATCH')) {
      expect(
        snapshot.card.paths.length,
        `the card for ${snapshot.itemId} named the files the wire had already named`,
      ).toBeGreaterThan(0)
      expect(
        snapshot.card.underDisclosed,
        `…and did not claim to be short of a disclosure it made (${snapshot.itemId})`,
      ).toBe(false)
    }
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 900_000)
