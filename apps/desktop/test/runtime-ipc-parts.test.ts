import { describe, expect, it } from 'vitest'
import * as ipc from '../src/shared/runtime-ipc'
import { RUNTIME_CHANGE_SUBJECTS } from '../src/shared/runtime-ipc-parts/change-notices'
import {
  FIRST_MESSAGE_REFUSALS,
  LAUNCH_REFUSALS,
} from '../src/shared/runtime-ipc-parts/launch-vocabulary'
import {
  LIBRARY_ARCHIVED,
  LIBRARY_KINDS,
  LIBRARY_ORIGINS,
} from '../src/shared/runtime-ipc-parts/library-vocabulary'

describe('runtime IPC vocabulary compatibility exports', () => {
  it.each([
    ['RUNTIME_CHANGE_SUBJECTS', RUNTIME_CHANGE_SUBJECTS],
    ['LIBRARY_ORIGINS', LIBRARY_ORIGINS],
    ['LIBRARY_KINDS', LIBRARY_KINDS],
    ['LIBRARY_ARCHIVED', LIBRARY_ARCHIVED],
    ['LAUNCH_REFUSALS', LAUNCH_REFUSALS],
    ['FIRST_MESSAGE_REFUSALS', FIRST_MESSAGE_REFUSALS],
  ] as const)('%s exposes the original leaf array instance', (name, vocabulary) => {
    expect(ipc[name]).toBe(vocabulary)
  })
})
