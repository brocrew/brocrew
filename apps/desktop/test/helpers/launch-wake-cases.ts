import { expect, it } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { SessionStore } from '../../src/main/db/session-store'
import type { CutState } from '../../src/main/turns-the-app-cut-file'
import type { RuntimeHost, RuntimeEventSink } from './giver-notice-host'
import type { Stops } from './cut-account-cases'

const BACKGROUND_NOTICE = 'background-work-a-restart-stopped'

interface ALife {
  readonly host: RuntimeHost
  readonly store: SessionStore
  readonly asked: string[]
  readonly startedAt: number[]
}

interface LaunchWakeContext {
  life(): ALife
  ledger(id: string): TranscriptEvent[]
  askedFor(life: ALife, id: string): number
  root(): string
  window(): RuntimeEventSink
  aTurnRunsIn(stops?: Stops): Promise<string>
  starts(moment: number, stops?: Stops): unknown
  aGivenPieceIsCut(how: 'quit' | 'crash'): Promise<{ lead: string; worker: string }>
  toldItStalled(lead: string): boolean
  restarted(id: string): number
  stateOf(id: string): CutState | undefined
  continuations(id: string): string[]
  waitFor(predicate: () => boolean, what: string): Promise<void>
  settle(): Promise<void>
  CUT: number
  SOON: number
}

/**
 * The restart's wake for stopped background work and a cut turn's wake share one line and the
 * steps around each start: the cut kept as starting, the givers asked once the start has ended, and
 * the pacing that the next start waits on. These pin those steps on the restart wake's side.
 */
export function registerLaunchWakeCases(ctx: LaunchWakeContext): void {
  const { life, ledger, waitFor, settle, stateOf, continuations, restarted, toldItStalled } = ctx
  const askedFor = (id: string): number => ctx.askedFor(life(), id)
  const runsInTheBackground = (id: string): void => {
    life().store.append(
      id,
      life().store.nextOrdinal(id),
      {
        type: 'background_work',
        running: [{ id: 't0', description: 'Run the full live test' }],
        source: 'test',
      } as unknown as TranscriptEvent,
      ctx.CUT - 5_000,
    )
  }
  const backgroundNoticeEnded = (id: string): boolean =>
    ledger(id).some(
      (event) =>
        event.type === 'message_unqueued' &&
        (event as { appNotice?: string }).appNotice === BACKGROUND_NOTICE,
    )

  it('the restart wake carries a quit’s cut on its own start, and its giver is not told the work stopped', async () => {
    // ⚑ The continuation is sent with the background notice, as one turn.
    const { lead, worker } = await ctx.aGivenPieceIsCut('quit')
    runsInTheBackground(worker)
    ctx.starts(ctx.SOON, { turnsStayOpen: true })
    await waitFor(() => stateOf(worker) === 'sent', 'the continuation to be sent')
    await settle()
    expect(askedFor(worker)).toBe(1)
    // Both notices go in as one turn of the app's own words.
    const turns = ledger(worker).filter((event) => event.type === 'user_turn')
    expect(turns).toHaveLength(2)
    expect((turns.at(-1) as { text: string }).text).toContain('stopped your background work')
    expect(continuations(worker)).toEqual([])
    expect(
      life()
        .store.piecesOwnedBy(worker)
        .map((piece) => piece.state),
    ).toEqual(['working'])
    expect(restarted(worker)).toBe(0)
    expect(toldItStalled(lead)).toBe(false)
  })

  it('⛔ when that start fails, the cut ends start-failed, the notice is ended, the work stalls, and the giver is told as it starts', async () => {
    const { lead, worker } = await ctx.aGivenPieceIsCut('quit')
    runsInTheBackground(worker)
    ctx.starts(ctx.SOON, { startsFailFor: 'agent-w' })
    await waitFor(() => typeof stateOf(worker) === 'object', 'the cut to end')
    await waitFor(() => backgroundNoticeEnded(worker), 'the background notice to be ended')
    await settle()
    expect(stateOf(worker)).toEqual({ ended: 'start-failed' })
    expect(askedFor(worker)).toBe(1)
    expect(continuations(worker)).toEqual([])
    // ⚑ Its work stalls as an interrupted turn, not as the restart's own row.
    expect(restarted(worker)).toBe(0)
    expect(
      life()
        .store.piecesOwnedBy(worker)
        .map((piece) => [piece.state, piece.stalledBecause]),
    ).toEqual([['stalled', 'turn_interrupted']])
    expect(toldItStalled(lead)).toBe(false)
    const sent = await life().host.startAndSend(lead, 'how is it going?', ctx.window())
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => toldItStalled(lead), 'its giver to be told')
  })

  it('a cut turn’s start waits four gaps after the restart wake’s start before it', async () => {
    const cut = await ctx.aTurnRunsIn()
    const { sessionId: stopped } = await life().host.createSession(
      { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: ctx.root() },
      ctx.window(),
    )
    await settle()
    await life().host.closeAll()
    runsInTheBackground(stopped)
    ctx.starts(ctx.SOON)
    // The restart wake's start goes first, alone.
    await waitFor(() => askedFor(stopped) === 1, 'the restart wake’s start')
    expect(askedFor(cut)).toBe(0)
    await waitFor(() => continuations(cut).length === 1, 'the cut turn’s continuation')
    const { asked, startedAt, host } = life()
    const gap = (host as unknown as { startGapMs: number }).startGapMs
    expect(asked).toHaveLength(2)
    expect((startedAt[1] ?? 0) - (startedAt[0] ?? 0)).toBeGreaterThanOrEqual(4 * gap - 5)
  })
}
