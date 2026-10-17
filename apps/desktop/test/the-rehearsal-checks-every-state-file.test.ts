import { describe, expect, it } from 'vitest'
import { STATE_FILES } from '../../../scripts/lib/update-rehearsal.mjs'
import { APP_STATE_FILES } from '../src/main/recovery/state-files'

/**
 * The update rehearsal checks a recovery copy against its manifest from outside the app, with Node's
 * own modules, so it keeps its own list of the files a copy carries. This holds that list to the
 * app's: a state file the app adds is one the rehearsal checks too.
 */
describe('the update rehearsal knows every state file a recovery copy carries', () => {
  it('its list is the app’s, in the app’s order', () => {
    expect([...STATE_FILES]).toEqual(APP_STATE_FILES.map((one) => one.name))
  })
})
