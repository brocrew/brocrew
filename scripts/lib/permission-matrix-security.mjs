import { readFileSync } from 'node:fs'

/**
 * Read `security-block.txt` verbatim and place it in each live identity's own instructions
 * through the harness's `instructAgent` call before a provider turn. The launch bundle then
 * carries the same bytes to controller and children without model transcription.
 * Keep the block as `.txt`: Markdown formatting can reflow it and change the required bytes.
 * `permission-matrix-security.test.mjs` compares it with the fixed fixture.
 */
export const PERMISSION_MATRIX_SECURITY_BLOCK = readFileSync(
  new URL('./security-block.txt', import.meta.url),
  'utf8',
)

/** Step 82 accepts no hidden/prerender fallback: its queue refresh is a visible-page timer. */
export function matrixPageIsVisible(visibilityState) {
  return visibilityState === 'visible'
}

/** Extra Electron arguments may tune the owned launch, never choose its identity or CDP port. */
export function electronArgumentOverridesSmokeOwnership(argument) {
  return /^(?:--user-data-dir|--remote-debugging-port|--remoteDebuggingPort)(?:=|$)/.test(argument)
}
