import { join } from 'node:path'
import { expect, it } from 'vitest'
import { managedTranscriptSettings } from '../src/claude/app-transcript-retention'

it('puts effectively-never cleanup in the flag layer only for a home below the explicit app root', () => {
  const root = join('/fictional', 'brocrew', 'provider-homes')
  expect(
    managedTranscriptSettings(join(root, 'default', 'fictional-agent', 'claude'), root),
  ).toEqual({ cleanupPeriodDays: 36500 })
  for (const home of [
    join('/fictional-person', '.claude'),
    join(root, '..', 'claude'),
    join(root + '-other', 'default', 'agent', 'claude'),
    join(root, 'default', 'agent', 'codex'),
  ]) {
    expect(managedTranscriptSettings(home, root)).toEqual({})
  }
  expect(managedTranscriptSettings(join(root, 'default', 'agent', 'claude'))).toEqual({})
})
