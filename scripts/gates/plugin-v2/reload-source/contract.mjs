// packaged-plugin-gate-only; source-only preview. No imports of application code here.
import assert from 'node:assert/strict'
export const SOURCE = '8f1b63ef1d22a9c8603ab2da6be18b6e48a4dd3c'
export const TREE = '17d79356fe29ec5b462185ca4828c7519bb7f1e7'
export const MODE = 'controlled-queryFactory-and-child-witness'
export const MARKER = 'packaged-plugin-gate-only:reload-v1'
export const SDK_VERSION = '0.3.287'
export const SHA256 = /^[0-9a-f]{64}$/
export const DELIVERY_WORDS = Object.freeze(['reload original fern', 'reload queued birch', 'reload queued cedar'])
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
  assert.equal(value.schema, 'brocrew.reload-main-app-behavior.v1')
  assert.equal(value.fixtureMarker, MARKER)
  assert.equal(value.hostBinding, 'projected-index-runtimeHost-and-same-store')
  assert.equal(value.nativeDatabaseClosure, 'external-native-app-receipt-required')
  assert.equal(value.nativeIpcJourney, 'EXTERNAL-DRIVER-EVIDENCE-REQUIRED')
  const { fixtureMarker, hostBinding, nativeDatabaseClosure, nativeIpcJourney, ...core } = value
  void fixtureMarker
  void hostBinding
  void nativeDatabaseClosure
  void nativeIpcJourney
  checkBehavior({ ...core, schema: 'brocrew.reload-behavior.v1' }, true)
  return value
}
function checkBehavior(value, mainApp) {
  exactKeys(value, ['schema', 'mode', 'sourceSha', 'sourceTree', 'sdkDeclaredVersion', 'adapter', 'hostQueue', 'cleanup'])
  assert.equal(value.schema, 'brocrew.reload-behavior.v1')
  assert.equal(value.mode, MODE)
  assert.equal(value.sourceSha, SOURCE)
  assert.equal(value.sourceTree, TREE)
  assert.equal(value.sdkDeclaredVersion, SDK_VERSION)
  const a = value.adapter
  exactKeys(a, ['timeoutMs', 'failedTerminals', 'failedByApp', 'oldPushes', 'oldReloads', 'oldCloses', 'oldReturns', 'retiringAtTimeout', 'oldSendRefusals', 'lateReloadReleased', 'lateResultAttempted', 'lateAddedTerminals', 'retirementEnded', 'freshQueries', 'freshResumeMatches', 'freshPushes', 'freshReloads', 'freshCompleted'])
  assert(Number.isSafeInteger(a.timeoutMs) && a.timeoutMs >= 10000 && a.timeoutMs <= 12500, 'real reload deadline not observed')
  for (const key of ['failedTerminals', 'oldReloads', 'oldCloses', 'oldReturns', 'freshQueries', 'freshPushes', 'freshReloads', 'freshCompleted']) assert.equal(a[key], 1, key)
  for (const key of ['oldPushes', 'lateAddedTerminals']) assert.equal(a[key], 0, key)
  assert.equal(a.oldSendRefusals, 2)
  for (const key of ['failedByApp', 'retiringAtTimeout', 'lateReloadReleased', 'lateResultAttempted', 'retirementEnded', 'freshResumeMatches']) assert.equal(a[key], true, key)
  const h = value.hostQueue
  exactKeys(h, ['timeoutMs', 'failedTerminals', 'failedByApp', 'oldPushes', 'oldReloads', 'oldCloses', 'oldReturns', 'failedAtTimeout', 'queuedBeforeExit', 'freshBeforeReturn', 'freshBeforeExit', 'starts', 'resumes', 'freshQueries', 'freshResumeMatches', 'freshReloads', 'freshPushes', 'uniqueUserUuids', 'originalOnce', 'secondOnce', 'thirdOnce', 'ledgerUserTurns', 'freshCompleted', 'lateAddedPushes', 'lateAddedTerminals', 'deliveredMessages', 'ledgerMessages'])
  assert(Number.isSafeInteger(h.timeoutMs) && h.timeoutMs >= 10000 && h.timeoutMs <= 12500)
  for (const key of ['failedTerminals', 'oldReloads', 'oldCloses', 'oldReturns', 'starts', 'resumes', 'freshQueries']) assert.equal(h[key], 1, key)
  for (const key of ['oldPushes', 'freshBeforeReturn', 'freshBeforeExit', 'lateAddedPushes', 'lateAddedTerminals']) assert.equal(h[key], 0, key)
  assert.equal(h.queuedBeforeExit, 2)
  assert.equal(h.failedAtTimeout, 1)
  assert.equal(h.failedTerminals, h.failedAtTimeout)
  assert(Number.isSafeInteger(h.freshPushes) && h.freshPushes >= 1 && h.freshPushes <= DELIVERY_WORDS.length)
  for (const key of ['freshReloads', 'uniqueUserUuids', 'ledgerUserTurns', 'freshCompleted']) assert.equal(h[key], h.freshPushes, key)
  assert.deepEqual(h.deliveredMessages, DELIVERY_WORDS)
  assert.deepEqual(h.ledgerMessages, DELIVERY_WORDS)
  for (const key of ['failedByApp', 'freshResumeMatches', 'originalOnce', 'secondOnce', 'thirdOnce']) assert.equal(h[key], true, key)
  exactKeys(value.cleanup, ['handles', 'endedHandles', 'queries', 'closedQueries', 'returnedQueries', 'settledReturns', 'drainedPromptReaders', 'exitedChildren', 'closedPipes', 'registeredHandles', 'allHandlesClosed', 'controlledChildrenExited', 'databaseClosed'])
  for (const key of ['handles', 'endedHandles', 'queries', 'closedQueries', 'returnedQueries', 'settledReturns', 'drainedPromptReaders', 'exitedChildren']) assert.equal(value.cleanup[key], 4, key)
  assert.equal(value.cleanup.closedPipes, 12)
  assert.equal(value.cleanup.registeredHandles, 0)
  for (const key of ['allHandlesClosed', 'controlledChildrenExited']) assert.equal(value.cleanup[key], true, key)
  assert.equal(value.cleanup.databaseClosed, !mainApp, 'Database closure ownership differs')
  return value
}

export const OPS = Object.freeze(['arm', 'status', 'releaseReload', 'releaseRetirement', 'receipt'])
export function assertCommand(input) {
  exactKeys(input, ['op'])
  assert(OPS.includes(input.op), 'Reload command refused')
  return input
}
export function assertStatus(value) {
  exactKeys(value, ['schema', 'phase', 'queryCount', 'oldReloads', 'oldCloses', 'oldReturns', 'oldPushes', 'freshPushes', 'failedTerminals', 'completedTerminals', 'retiring', 'arrivalTailChanges'])
  assert.equal(value.schema, 'brocrew.reload-status.v1')
  assert(['armed', 'retiring-held', 'reload-released', 'retirement-released', 'complete'].includes(value.phase))
  for (const key of ['queryCount', 'oldReloads', 'oldCloses', 'oldReturns', 'oldPushes', 'freshPushes', 'failedTerminals', 'completedTerminals', 'arrivalTailChanges']) assert(Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 4, key)
  assert.equal(typeof value.retiring, 'boolean')
  return value
}
