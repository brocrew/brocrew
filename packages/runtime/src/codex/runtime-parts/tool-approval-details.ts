import type { RuntimeEvent } from '../../events'
import type { ClaimedToolApproval } from '../external-mcp'

// Describe the claimed tool with parameters in provider order and the original omitted count.
export function toolApprovalCall(
  approval: Pick<ClaimedToolApproval, 'serverName' | 'parameters' | 'parametersOmitted'>,
  tool: string,
): NonNullable<Extract<RuntimeEvent, { type: 'permission_request' }>['mcpToolCall']> {
  return {
    server: approval.serverName,
    tool,
    parameters: [...approval.parameters],
    ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),
  }
}
