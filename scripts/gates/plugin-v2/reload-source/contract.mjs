// packaged-plugin-gate-only; source-only preview. No imports of application code here.
import assert from 'node:assert/strict'
export const SOURCE = '8f1b63ef1d22a9c8603ab2da6be18b6e48a4dd3c'
export const TREE = '17d79356fe29ec5b462185ca4828c7519bb7f1e7'
export const MODE = 'controlled-queryFactory-and-child-witness'
export const MARKER = 'packaged-plugin-gate-only:reload-v1'
export const SDK_VERSION = '0.3.287'
// Card 197 removed the 60 s reload clock: a held reload must outlast that old limit without failing,
// and only the CLI's exit ends it.
export const RELOAD_HELD_MS = 65_000
export const RELOAD_JOURNEY_WAIT_MS = RELOAD_HELD_MS + 20_000
export const SHA256 = /^[0-9a-f]{64}$/
export const DELIVERY_WORDS = Object.freeze(['reload original fern', 'reload queued birch', 'reload queued cedar'])
export function lifecycleEvidence(events) {
  const lifecycle = events.filter(event => event.type === 'launched' || event.type === 'reopened')
  assert.equal(lifecycle[0]?.type, 'launched', 'Initial launch missing or out of order')
  assert.equal(lifecycle.length % 2, 1, 'Resume launch missing')
  for (let index = 1; index < lifecycle.length; index += 2) {
    assert.equal(lifecycle[index].type, 'reopened', 'Unexpected launch without a resume')
    assert.equal(lifecycle[index + 1].type, 'launched', 'Resume launch missing or out of order')
  }
  return { starts: 1, resumes: (lifecycle.length - 1) / 2 }
}
export function deliveryMessages(pushes) {
  return pushes.flatMap(({ message }) => {
    assert.equal(typeof message.content, 'string')
    const words = message.content.split(/\r?\n/).map(line => line.trim()).filter(line => DELIVERY_WORDS.includes(line))
    assert(words.length > 0, 'Unexpected prompt without a fixture message')
    return words
  })
}
export function deliveryEvidence(pushes, userTurns) {
  assert(pushes.length >= 1 && pushes.length <= DELIVERY_WORDS.length)
  const deliveredMessages = deliveryMessages(pushes)
  const ledgerGroups = userTurns.map(event => {
    const words = event.parts ? event.parts.map(part => part.text) : [event.text]
    assert.equal(event.text, words.join('\n\n'), 'Ledger parts disagree with turn text')
    return words
  })
  const ledgerMessages = ledgerGroups.flat()
  assert.deepEqual(pushes.map(push => deliveryMessages([push])), ledgerGroups, 'Consumed prompts disagree with ledger message groups')
  assert.deepEqual(deliveredMessages, DELIVERY_WORDS, 'Messages were lost, duplicated or reordered at the query')
  assert.deepEqual(ledgerMessages, DELIVERY_WORDS, 'Messages were lost, duplicated or reordered in the ledger')
  assert.equal(userTurns.length, pushes.length, 'Ledger turns disagree with consumed prompts')
  return { deliveredMessages, ledgerMessages }
}

export function exactKeys(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'closed object required')
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected or missing field')
}
export function assertBehavior(value) {
  return checkBehavior(value, false)
}
export function assertMainAppBehavior(value) {
  exactKeys(value, ['schema', 'fixtureMarker', 'mode', 'sourceSha', 'sourceTree', 'sdkDeclaredVersion', 'hostBinding', 'nativeDatabaseClosure', 'nativeIpcJourney', 'adapter', 'hostQueue', 'cleanup'])
  assert.equal(value.schema, 'brocrew.reload-main-app-behavior.v2')
  assert.equal(value.fixtureMarker, MARKER)
  assert.equal(value.hostBinding, 'projected-index-runtimeHost-and-same-store')
  assert.equal(value.nativeDatabaseClosure, 'external-native-app-receipt-required')
  assert.equal(value.nativeIpcJourney, 'EXTERNAL-DRIVER-EVIDENCE-REQUIRED')
  const { fixtureMarker, hostBinding, nativeDatabaseClosure, nativeIpcJourney, ...core } = value
  void fixtureMarker
  void hostBinding
  void nativeDatabaseClosure
  void nativeIpcJourney
  checkBehavior({ ...core, schema: 'brocrew.reload-behavior.v2' }, true)
  return value
}
function checkBehavior(value, mainApp) {
  exactKeys(value, ['schema', 'mode', 'sourceSha', 'sourceTree', 'sdkDeclaredVersion', 'adapter', 'hostQueue', 'cleanup'])
  assert.equal(value.schema, 'brocrew.reload-behavior.v2')
  assert.equal(value.mode, MODE)
  assert.equal(value.sourceSha, SOURCE)
  assert.equal(value.sourceTree, TREE)
  assert.equal(value.sdkDeclaredVersion, SDK_VERSION)
  const a = value.adapter
  exactKeys(a, ['heldMs', 'heldWithoutFailure', 'failedTerminals', 'failedByApp', 'exitRejected', 'oldPushes', 'oldReloads', 'oldSendRefusals', 'lateAddedTerminals', 'exitObserved', 'freshQueries', 'freshResumeMatches', 'freshPushes', 'freshReloads', 'freshCompleted'])
  assert(Number.isSafeInteger(a.heldMs) && a.heldMs >= RELOAD_HELD_MS, 'reload not held past the removed limit')
  for (const key of ['failedTerminals', 'oldReloads', 'freshQueries', 'freshPushes', 'freshReloads', 'freshCompleted']) assert.equal(a[key], 1, key)
  for (const key of ['oldPushes', 'lateAddedTerminals']) assert.equal(a[key], 0, key)
  assert.equal(a.oldSendRefusals, 2)
  for (const key of ['heldWithoutFailure', 'failedByApp', 'exitRejected', 'exitObserved', 'freshResumeMatches']) assert.equal(a[key], true, key)
  const h = value.hostQueue
  exactKeys(h, ['heldMs', 'heldWithoutFailure', 'failedTerminals', 'failedByApp', 'oldPushes', 'oldReloads', 'queuedWhileHeld', 'freshBeforeReturn', 'starts', 'resumes', 'freshQueries', 'freshResumeMatches', 'freshReloads', 'freshPushes', 'uniqueUserUuids', 'originalOnce', 'secondOnce', 'thirdOnce', 'ledgerUserTurns', 'freshCompleted', 'lateAddedPushes', 'lateAddedTerminals', 'deliveredMessages', 'ledgerMessages'])
  assert(Number.isSafeInteger(h.heldMs) && h.heldMs >= RELOAD_HELD_MS, 'reload not held past the removed limit')
  for (const key of ['failedTerminals', 'oldReloads', 'starts', 'resumes', 'freshQueries']) assert.equal(h[key], 1, key)
  for (const key of ['oldPushes', 'freshBeforeReturn', 'lateAddedPushes', 'lateAddedTerminals']) assert.equal(h[key], 0, key)
  assert.equal(h.queuedWhileHeld, 2)
  assert(Number.isSafeInteger(h.freshPushes) && h.freshPushes >= 1 && h.freshPushes <= DELIVERY_WORDS.length)
  for (const key of ['freshReloads', 'uniqueUserUuids', 'ledgerUserTurns', 'freshCompleted']) assert.equal(h[key], h.freshPushes, key)
  assert.deepEqual(h.deliveredMessages, DELIVERY_WORDS)
  assert.deepEqual(h.ledgerMessages, DELIVERY_WORDS)
  for (const key of ['heldWithoutFailure', 'failedByApp', 'freshResumeMatches', 'originalOnce', 'secondOnce', 'thirdOnce']) assert.equal(h[key], true, key)
  exactKeys(value.cleanup, ['handles', 'endedHandles', 'queries', 'closedQueries', 'returnedQueries', 'settledReturns', 'drainedPromptReaders', 'exitedChildren', 'closedPipes', 'registeredHandles', 'allHandlesClosed', 'controlledChildrenExited', 'databaseClosed'])
  for (const key of ['handles', 'endedHandles', 'queries', 'closedQueries', 'returnedQueries', 'settledReturns', 'drainedPromptReaders', 'exitedChildren']) assert.equal(value.cleanup[key], 4, key)
  assert.equal(value.cleanup.closedPipes, 12)
  assert.equal(value.cleanup.registeredHandles, 0)
  for (const key of ['allHandlesClosed', 'controlledChildrenExited']) assert.equal(value.cleanup[key], true, key)
  assert.equal(value.cleanup.databaseClosed, !mainApp, 'Database closure ownership differs')
  return value
}

export const OPS = Object.freeze(['arm', 'status', 'exitCli', 'receipt'])
export function assertCommand(input) {
  exactKeys(input, ['op'])
  assert(OPS.includes(input.op), 'Reload command refused')
  return input
}
export function assertStatus(value) {
  exactKeys(value, ['schema', 'phase', 'queryCount', 'oldReloads', 'oldPushes', 'freshPushes', 'failedTerminals', 'completedTerminals', 'queuedWhileHeld', 'heldMs'])
  assert.equal(value.schema, 'brocrew.reload-status.v2')
  assert(['armed', 'reload-held', 'cli-exited', 'complete'].includes(value.phase))
  for (const key of ['queryCount', 'oldReloads', 'oldPushes', 'freshPushes', 'failedTerminals', 'completedTerminals', 'queuedWhileHeld']) assert(Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 4, key)
  assert(Number.isSafeInteger(value.heldMs) && value.heldMs >= 0, 'heldMs')
  return value
}
