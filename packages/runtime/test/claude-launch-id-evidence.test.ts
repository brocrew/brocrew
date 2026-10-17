import { describe, expect, it } from 'vitest'
import { launchIdVerdict, type LaunchSeen } from '../smoke/claude-launch-id-evidence'

/**
 * 🔴 **722 · R79 — `probe:claude-launch-id`'s verdict, pinned in `ci`.** The probe runs the bundled
 * CLI against a loopback model and is not part of `ci`; what its record MEANS is decided here, on
 * planted arms one fact apart, so a probe that measured nothing cannot read as R79 holding.
 */

const ASKED = '7b0e6a52-1f7c-4d2e-9a31-5c8e2f40b9d1'
const CLOSED = '3c9d1e70-8b4a-4f25-b6e1-0a7d92c4e583'
const THE_CLIS_OWN = '07647b98-1c8e-4095-a2ee-1bc20b1de318'
/** The subject's folder as launched (a symlink), and as the CLI resolved and recorded it. */
const LINKED = '/tmp/probe/linked-cwd'
const RESOLVED = '/private/tmp/probe/cwd'

/** The shape a run that holds R79 records — every arm. */
const holding = (): LaunchSeen[] => [
  {
    arm: 'finishes',
    asked: ASKED,
    initId: ASKED,
    initBeforeClose: null,
    transcripts: [ASKED],
    announced: ASKED,
    announcedOn: 'started',
    resumed: null,
    cwdLaunched: null,
    cwdRecorded: null,
    cwdAnnounced: null,
  },
  {
    arm: 'closed-before-init',
    asked: CLOSED,
    initId: null,
    initBeforeClose: false,
    transcripts: [CLOSED],
    announced: CLOSED,
    announcedOn: 'ended',
    resumed: true,
    cwdLaunched: LINKED,
    cwdRecorded: RESOLVED,
    cwdAnnounced: RESOLVED,
  },
  {
    arm: 'named-none',
    asked: null,
    initId: null,
    initBeforeClose: false,
    transcripts: [THE_CLIS_OWN],
    announced: null,
    announcedOn: null,
    resumed: null,
    cwdLaunched: null,
    cwdRecorded: null,
    cwdAnnounced: null,
  },
  {
    arm: 'never-sent',
    asked: '9e2a41c7-55d0-4c6b-8f13-e7b0d2a9c461',
    initId: null,
    initBeforeClose: null,
    transcripts: [],
    announced: null,
    announcedOn: null,
    resumed: null,
    cwdLaunched: null,
    cwdRecorded: null,
    cwdAnnounced: null,
  },
]

/** `holding()` with one arm changed — one fact over. */
function with_(arm: LaunchSeen['arm'], change: Partial<LaunchSeen>): LaunchSeen[] {
  return holding().map((one) => (one.arm === arm ? { ...one, ...change } : one))
}

describe('722 · R79 — the launch-id probe’s verdict', () => {
  it('⚑ the shape R79 needs reads as holding', () => {
    expect(launchIdVerdict(holding())).toEqual({ verdict: 'names-its-own' })
  })

  it('⛔ a premise the child did not meet is NOT PERFORMED — never a finding about the product', () => {
    expect(launchIdVerdict(with_('closed-before-init', { initBeforeClose: true }))).toMatchObject({
      verdict: 'not-performed',
      why: expect.stringContaining('closed-before-init: an init was read before the close'),
    })
    expect(launchIdVerdict(with_('named-none', { initBeforeClose: true }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(
      launchIdVerdict(with_('closed-before-init', { transcripts: [], announced: null })),
    ).toMatchObject({ verdict: 'not-performed', why: expect.stringContaining('nothing to name') })
    expect(launchIdVerdict(with_('named-none', { asked: ASKED }))).toMatchObject({
      verdict: 'not-performed',
      why: expect.stringContaining('not the control'),
    })
    expect(launchIdVerdict(holding().slice(1))).toMatchObject({ verdict: 'not-performed' })
    // ⛔ An init that landed DURING the close — the ordinary init path named it, not R79's.
    expect(
      launchIdVerdict(with_('closed-before-init', { initId: CLOSED, announcedOn: 'started' })),
    ).toMatchObject({
      verdict: 'not-performed',
      why: expect.stringContaining(
        'closed-before-init: an init reached the adapter during the close',
      ),
    })
    // ⛔ The subject's folder was not resolved by the CLI — the recorded-spelling path unexercised.
    expect(launchIdVerdict(with_('closed-before-init', { cwdRecorded: LINKED }))).toMatchObject({
      verdict: 'not-performed',
      why: expect.stringContaining('recorded the folder as it was launched'),
    })
    expect(launchIdVerdict(with_('named-none', { initId: THE_CLIS_OWN }))).toMatchObject({
      verdict: 'not-performed',
      why: expect.stringContaining('named-none: an init reached the adapter during the close'),
    })
  })

  it('🔴 each way the CLI or the product can have moved reads as moved, and says which', () => {
    // The CLI ignored the id — the init, and so the transcript, are its own.
    expect(launchIdVerdict(with_('finishes', { initId: THE_CLIS_OWN }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('finishes: the init named'),
    })
    expect(launchIdVerdict(with_('finishes', { asked: null }))).toMatchObject({ verdict: 'moved' })
    // The subject's transcript under another id — `717`'s defect.
    expect(
      launchIdVerdict(with_('closed-before-init', { transcripts: [THE_CLIS_OWN] })),
    ).toMatchObject({ verdict: 'moved', why: expect.stringContaining('not the id asked for') })
    // The product did not announce it — the row would stay without a ref.
    expect(launchIdVerdict(with_('closed-before-init', { announced: null }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('the product announced null'),
    })
    // Announced in the folder as TYPED, not the one the CLI recorded — a reopen's init would refuse it.
    expect(launchIdVerdict(with_('closed-before-init', { cwdAnnounced: LINKED }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('not the one the CLI recorded'),
    })
    // Announced, but on a door other than the close's.
    expect(launchIdVerdict(with_('closed-before-init', { announcedOn: 'started' }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('not as the conversation ended'),
    })
    // Announced, but a reopen by it took no turn under that ref.
    expect(launchIdVerdict(with_('closed-before-init', { resumed: false }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('reopen'),
    })
    expect(launchIdVerdict(with_('closed-before-init', { resumed: null }))).toMatchObject({
      verdict: 'moved',
    })
    // The control announced an id it never asked for.
    expect(launchIdVerdict(with_('named-none', { announced: THE_CLIS_OWN }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('named-none'),
    })
    // A launch that sent nothing left a transcript behind.
    expect(launchIdVerdict(with_('never-sent', { transcripts: [ASKED] }))).toMatchObject({
      verdict: 'moved',
      why: expect.stringContaining('never-sent'),
    })
  })
})
