import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_LINE,
  CLOSED_WHILE_CHECKING,
  FAIL_LINE,
  OPENED_FOR_RECOVERY_LINE,
  OPENED_NORMALLY_LINE,
  READY_LINE,
} from '../../src/main/recovery/log-lines'

describe('the lines a start prints', () => {
  it('keep the exact text a watching process matches', () => {
    expect(READY_LINE).toBe('BroCrew is ready: its data is open and checked.')
    expect(CHECKPOINT_LINE).toBe('BroCrew made a checked recovery copy before changing its data.')
    expect(FAIL_LINE).toBe('BroCrew did not start.')
    expect(CLOSED_WHILE_CHECKING).toBe('BroCrew was closed while it was checking its data.')
  })

  it('and the two a hidden launch says about the way its start went', () => {
    expect(OPENED_NORMALLY_LINE).toBe('BroCrew opened its data normally.')
    expect(OPENED_FOR_RECOVERY_LINE).toBe(
      'BroCrew opened only its recovery window: its data is not opened for work.',
    )
  })
})
