import { closedFrames } from './diagnostics.mjs'

export const providerSteps = [
  'agent-start',
  'turn-sent',
  'mcp-attached',
  'tool-called',
  'cdp-navigate',
  'result-returned',
]
export const providerErrors = [
  'session',
  'bridge',
  'prompt',
  'route-absent',
  'route-invalid',
  'connect',
  'inventory',
  'tool',
  'navigation',
  'snapshot',
  'timeout',
  'other',
]
export function safeProviderState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'errorCategory,phase,step' &&
    value.phase === 'provider-action' &&
    providerSteps.includes(value.step) &&
    providerErrors.includes(value.errorCategory)
  )
}
// Pick the first missing witness, never the last operation attempted.
export function providerState(proof, turn, category = 'other') {
  const witnesses = [
    proof.homePrepared === true && proof.agentStarted === true && turn?.started === true,
    proof.turnSent === true,
    proof.routeReady === true,
    proof.toolCalled === true,
    proof.navigations > 0,
    proof.toolRead === true && proof.titleReturned === true && turn?.returned === true,
  ]
  const missing = witnesses.findIndex((value) => !value)
  return {
    phase: 'provider-action',
    step: missing < 0 ? 'result-returned' : providerSteps[missing],
    errorCategory: providerErrors.includes(category) ? category : 'other',
  }
}
export function printProviderState(value, write = (line) => console.log(line)) {
  if (safeProviderState(value)) write('gate-provider-state ' + JSON.stringify(value))
}
export const providerStateFrames = (receive) =>
  closedFrames('gate-provider-state ', safeProviderState, receive)
