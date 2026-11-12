import type { RuntimeCommand } from '../../shared/runtime-ipc'
import type { RuntimeHost } from './runtime-host'

export function executeForestCommand(host: RuntimeHost, command: Extract<RuntimeCommand, { kind: 'forestReading' | 'forestNodes' }>) {
  return command.kind === 'forestReading' ? host.forestReading(command.scope) : host.forestNodes(command.drawn, command.conversations)
}
