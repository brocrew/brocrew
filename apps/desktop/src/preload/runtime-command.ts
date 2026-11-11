import { ipcRenderer } from 'electron'
import {
  RUNTIME_COMMAND_CHANNEL,
  type RuntimeCommand,
  type RuntimeCommandKind,
  type RuntimeCommandResult,
} from '../shared/runtime-ipc'

/**
 * Send one command; it answers what `RuntimeCommandResults` says that command answers, the
 * same map main's dispatch is checked against, so a reply typed one way on one side and another way
 * on the other does not typecheck. The one cast is the wire's own: `invoke` answers `any`.
 */
export function command<K extends RuntimeCommandKind>(
  payload: Extract<RuntimeCommand, { kind: K }> & { kind: K },
): Promise<RuntimeCommandResult<K>> {
  return ipcRenderer.invoke(RUNTIME_COMMAND_CHANNEL, payload) as Promise<RuntimeCommandResult<K>>
}
