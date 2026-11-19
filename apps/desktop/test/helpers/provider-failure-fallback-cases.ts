import { expect, it, vi } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { SessionStore } from '../../src/main/db/session-store'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import { waitFor } from '../lib/f093-host'

interface FailureFallbackContext {
  host(): RuntimeHost
  replaceHost(host: RuntimeHost): void
  create(): Promise<{ owner: string; work: { piece: string; label: string } }>
  store(): SessionStore
  build(): RuntimeHost
}

export function registerProviderFailureFallbackCases(
  context: FailureFallbackContext,
  tick: () => number,
  cycle: () => Promise<void>,
  noticeCount: (owner: string) => number,
): void {
  it.each(['person', 'unreadable episode'] as const)(
    'keeps the usual work reminder routing for provider-failed work with %s',
    async (route) => {
      const { owner, work } = await context.create()
      const giver = route === 'person' ? null : await context.create()
      await context.host().closeAll()
      const store = context.store()
      const piece = 'fictional-provider-failed-piece'
      const parent = giver?.work ?? work
      const givenBy = giver?.owner ?? null
      const brief = 'Fictional work that its provider could not finish.'
      const put = (event: TranscriptEvent) =>
        store.append(owner, store.nextOrdinal(owner), event, tick())
      store.recordGive(
        {
          piece,
          parent: parent.piece,
          number: 1,
          owner,
          givenBy,
          title: piece,
          brief,
          folder: null,
          inputs: [],
        },
        store.nextOrdinal(owner),
        {
          type: 'work_given',
          piece,
          parent: parent.piece,
          label: `${parent.label}.1`,
          givenBy,
          title: piece,
          brief,
        },
        tick(),
      )
      put({
        type: 'user_turn',
        text: brief,
        attribution: 'app_authored',
        appNotice: 'a-work-wait-needs-attention',
        drives: piece,
      })
      const failure = { message: 'The fictional model could not run.' }
      const terminalOrdinal = store.nextOrdinal(owner)
      put({ type: 'turn', state: 'failed', providerFailure: failure })
      expect(store.piecesOwnedBy(owner)).toContainEqual(
        expect.objectContaining({
          piece,
          stalledBecause: 'turn_ended',
          providerTurnFailure: { turnOrdinal: terminalOrdinal, ...failure },
        }),
      )
      expect(store.providerFailureEpisode(owner)).toMatchObject({ terminalOrdinal })
      put({
        type: 'work_reconciliation',
        incident: 'fictional-provider-failed-incident',
        piece,
        kind: 'stopped',
        cause: 'turn_ended',
        since: tick(),
        ...(giver === null
          ? { step: 'person', outcome: 'listed' }
          : {
              step: 'holder',
              outcome: 'failed',
              target: owner,
              messageId: 'fictional-holder-notice',
            }),
      })
      if (giver !== null) {
        const episode = store.providerFailureEpisode.bind(store)
        vi.spyOn(store, 'providerFailureEpisode').mockImplementation((holder, unread) =>
          holder === owner ? 'unknown' : episode(holder, unread),
        )
      }
      const host = context.build()
      context.replaceHost(host)
      if (giver === null) {
        expect(host.workIncidentsForAPerson().rows).toContainEqual(
          expect.objectContaining({ piece, kind: 'stopped', giver: null }),
        )
        return
      }
      await cycle()
      await waitFor(() => noticeCount(giver.owner) === 1, 'the ordinary notice for the giver')
      expect(store.reconciliationReceiptsForOwner(owner)).not.toContainEqual(
        expect.objectContaining({ kind: 'provider-turn-failed' }),
      )
    },
  )
}
