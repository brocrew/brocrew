import { describe, expect, it } from 'vitest'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
  requestDraft,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import { itemKey } from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **148 H3 · the request id AROUND the card, which 146 did not reach.**
 *
 * 146 hardened every INNER answer key — the question ids inside a card — and 148 confirmed that path
 * clean end to end. It missed the id of the REQUEST itself. Claude takes that one straight from the
 * SDK's `toolUseID` and types it only as `string`, so the whole prototype vocabulary is legal:
 *
 *  - `TranscriptState.requestItems` was `{}` and did `state.requestItems[event.id] = itemId` — for
 *    `__proto__` that hits the inherited setter and creates NO own mapping, so the card exists in
 *    the item list and nothing can ever find it again: no answer marks it, no resolution settles it.
 *  - `SessionRecord.requests` was `{}` and `requestDraft` returned any truthy lookup. `__proto__`
 *    returned `Object.prototype`; `constructor`, `toString` and `hasOwnProperty` returned the
 *    inherited FUNCTION. `UserInputCard` calls `draft.answers.get(...)` on that and **throws during
 *    render**; `PermissionCard`'s click writes `draft.sent = true` onto `Object.prototype` itself,
 *    which poisons every draft in the application.
 *
 * ⚠️ **It applies on REPLAY and IMPORT too**, because the same fold rebuilds `requestItems` from the
 * provider's ids — which is why every case here is asserted through a live fold AND through a
 * window opened over a replayed page.
 *
 * ⚑ Codex is safe and stays untested here: its outer keys are type-prefixed. The runtime broker is
 * safe too — it uses `Map`/`Set`. This is the Claude/replay renderer boundary.
 */

/** Every id that reads back truthy off an ordinary object without having been stored. */
const HOSTILE = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'] as const

const userInput = (id: string): RuntimeEventMessage['event'] => ({
  type: 'user_input_request',
  id,
  prompt: 'AskUserQuestion',
  questions: [
    { id: 'q0', prompt: 'Which one?', options: [{ label: 'alpha' }], multiSelect: false },
  ],
})

const permission = (id: string): RuntimeEventMessage['event'] => ({
  type: 'permission_request',
  id,
  kind: 'command',
  action: 'Bash',
  detail: 'run: ls',
  scope: {
    cwd: '/tmp/scratch',
    paths: [],
    networkHosts: [],
    persistence: 'once' as const,
    amendments: [],
    availableDecisions: ['allow' as const, 'deny' as const],
    underDisclosed: false,
  },
})

const message = (
  sessionId: string,
  ordinal: number,
  event: RuntimeEventMessage['event'],
): RuntimeEventMessage => ({ sessionId, ordinal, at: 1_000 + ordinal, event })

/** A pristine `Object.prototype` — read before each case so a leak cannot be inherited from one. */
function prototypeKeys(): string[] {
  return Object.getOwnPropertyNames(Object.prototype).sort()
}

describe('a request id from the prototype chain, AROUND the card (150, from 148 H3)', () => {
  for (const id of HOSTILE) {
    it(`folds, finds and drafts a user-input request whose id is \`${id}\``, () => {
      const clean = prototypeKeys()
      const record = createSessionRecord('sess_1')
      acceptEvent(record, message('sess_1', 0, userInput(id)))

      // ⛔ The card is in the list AND reachable by the id the provider used. `__proto__` used to
      // produce the first without the second: an item nothing could ever address again.
      const item = record.control.items.find((i) => i.kind === 'userInput')
      expect(item, `no card folded for ${id}`).toBeDefined()
      expect(record.control.requestItems.get(id)).toBe(item!.id)
      expect(itemKey(item!)).toContain(id)

      // ⛔ A draft, not `Object.prototype` and not a function. This is the render crash.
      const draft = requestDraft(record, id)
      expect(draft.answers).toBeInstanceOf(Map)
      expect(draft.sent).toBe(false)
      expect(typeof draft).toBe('object')
      draft.answers.set('q0', 'alpha')
      expect(requestDraft(record, id).answers.get('q0')).toBe('alpha')

      // …and a DIFFERENT hostile id is a different draft, rather than the same inherited thing.
      expect(requestDraft(record, 'toLocaleString').answers.size).toBe(0)
      expect(prototypeKeys()).toEqual(clean)
    })

    it(`settles a PERMISSION card whose id is \`${id}\` without writing to Object.prototype`, () => {
      const clean = prototypeKeys()
      const record = createSessionRecord('sess_2')
      acceptEvent(record, message('sess_2', 0, permission(id)))

      const draft = requestDraft(record, id)
      // The click PermissionCard makes. On an ordinary object this assignment landed on
      // `Object.prototype.sent` and every other card in the app read back `sent: true`.
      draft.sent = true
      expect(requestDraft(record, id).sent).toBe(true)
      expect(Object.hasOwn(Object.prototype, 'sent')).toBe(false)
      expect(({} as { sent?: boolean }).sent).toBeUndefined()
      // A card that was never drafted is still untouched — the positive half of the same claim.
      expect(requestDraft(record, 'req_ordinary').sent).toBe(false)
      expect(prototypeKeys()).toEqual(clean)
    })

    it(`rebuilds the mapping for \`${id}\` through REPLAY, not just through the live fold`, () => {
      const clean = prototypeKeys()
      const record: SessionRecord = createSessionRecord('sess_3')
      // A replayed page, which is the path an import and every reopen take: the window is opened
      // over stored events and the one exhaustive fold rebuilds `requestItems` from provider ids.
      const entries = [
        { ordinal: 0, at: 1_000, event: permission(id) },
        { ordinal: 1, at: 1_001, event: userInput(id + '_u') },
      ]
      // The real replay door: `openWindow` sets the cursor and clears the previous life, and the
      // entries go in through `acceptEvent` — the same one the live stream uses, which is the whole
      // reason a fold defect shows up identically on replay and on import.
      openWindow(record, { from: 0, hasOlder: false, turnAligned: true, entries })
      for (const entry of entries) {
        acceptEvent(record, {
          sessionId: 'sess_3',
          ordinal: entry.ordinal,
          at: entry.at,
          event: entry.event,
        })
      }

      const permItem = record.control.items.find((i) => i.kind === 'permission')
      const uiItem = record.control.items.find((i) => i.kind === 'userInput')
      expect(permItem, `no permission card replayed for ${id}`).toBeDefined()
      expect(uiItem, `no user-input card replayed for ${id}`).toBeDefined()
      expect(record.control.requestItems.get(id)).toBe(permItem!.id)
      expect(record.control.requestItems.get(id + '_u')).toBe(uiItem!.id)
      // The map holds exactly what was replayed — an inherited name is not a member of it.
      expect([...record.control.requestItems.keys()].sort()).toEqual([id, id + '_u'].sort())
      expect(prototypeKeys()).toEqual(clean)
    })
  }

  it('an ordinary provider id still works, so the hardening did not break addressing', () => {
    // The positive control. Every assertion above is about a hostile key surviving; this one is
    // about the ordinary case still being found, which is what a `Map` could plausibly break.
    const record = createSessionRecord('sess_4')
    acceptEvent(record, message('sess_4', 0, userInput('toolu_01ABC')))
    const item = record.control.items.find((i) => i.kind === 'userInput')
    expect(record.control.requestItems.get('toolu_01ABC')).toBe(item!.id)
    expect(record.control.requestItems.get('never_sent')).toBeUndefined()
  })
})
