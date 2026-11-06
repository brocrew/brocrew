import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import { captureProcessIdentity } from './lib/owned-process.mjs'
import {
  closeFamily,
  identityState,
  publish,
  readJson,
  sameLife,
} from './storage-round-trip-process.mjs'

// A separate process can freeze the still-live bootstrap group before closing descendant
// discovery. The bootstrap cannot freeze its own group and then finish that operation itself.
const directory = process.argv[2],
  saved = readJson(join(directory, 'registration.json')).identity
const me = captureProcessIdentity(process.pid),
  current = captureProcessIdentity(saved.pid)
if (!me || me.parentPid !== saved.pid || me.pgid !== me.pid || !sameLife(saved, current))
  throw new Error('Reaper authority unavailable')
const observed = join(directory, 'observed.json'),
  intent = readJson(join(directory, 'intent.json'))
if (identityState(intent.watchdog) !== 'gone' || identityState(intent.coordinator) !== 'gone')
  throw new Error('Prior closer is still alive or uncertain')
const identities = existsSync(observed) ? readJson(observed).identities : [saved]
const failureFile = join(intent.evidence, 'watchdog-failure.json')
const prior = existsSync(failureFile) ? readJson(failureFile) : {}
publish(failureFile, { ...prior, outcome: 'INCOMPLETE', complete: false, reaperStarted: true })
const closure = closeFamily(identities, { excludeSelfTree: true })
const receipt = { at: Date.now(), outcome: 'INCOMPLETE', closure, identities }
publish(join(directory, 'reaper-closure.json'), receipt)
publish(join(intent.evidence, 'admissions', basename(directory) + '-reaper.json'), receipt)
process.exitCode = closure.complete ? 0 : 1
