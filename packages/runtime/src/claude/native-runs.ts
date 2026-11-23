import {
  nativeRun,
  commandInput,
  agentInput,
  workflowInput,
  runLine,
  type NativeRun,
} from '../native-run'
import { textParts } from './tool-summary'

/** Call facts shared by live messages and imported transcript batches. */
export class ClaudeToolRuns {
  private readonly calls = new Map<string, { run: NativeRun; backgroundRequested: boolean }>()

  called(toolUseId: string, name: string, input: unknown): NativeRun | undefined {
    const run = claudeToolRun(name, input)
    if (run) {
      this.calls.set(toolUseId, {
        run,
        backgroundRequested:
          run.kind === 'command' &&
          (input as Record<string, unknown>)['run_in_background'] === true,
      })
    }
    return run
  }

  runFor(toolUseId: string): NativeRun | undefined {
    return this.calls.get(toolUseId)?.run
  }

  resultFor(toolUseId: string, content: unknown, ok: boolean): { result: string } | undefined {
    const call = this.calls.get(toolUseId)
    if (call?.run.kind !== 'command' || (call.backgroundRequested && ok)) return undefined
    return { result: runLine(textParts(content).join('\n'), true) ?? (ok ? 'Completed' : 'Failed') }
  }

  releaseCall(toolUseId: string): void {
    this.calls.delete(toolUseId)
  }
}

export function claudeRunKind(kind: string): NativeRun['kind'] | undefined {
  switch (kind) {
    case 'local_bash':
    case 'shell':
      return 'command'
    case 'local_agent':
    case 'subagent':
      return 'agent'
    case 'local_workflow':
    case 'workflow':
      return 'workflow'
    case 'monitor':
      return 'monitor'
    default:
      return undefined
  }
}

function claudeToolRun(name: string, input: unknown): NativeRun | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const fields = input as Record<string, unknown>
  const text = (key: string): string | undefined =>
    typeof fields[key] === 'string' ? fields[key] : undefined
  if (name === 'Bash')
    return nativeRun('command', {
      input: commandInput(text('command'), text('cwd')),
    })
  if (name === 'Agent' || name === 'Task')
    return nativeRun('agent', {
      input: agentInput(text('prompt'), text('subagent_type'), text('model')),
    })
  if (name === 'Workflow') {
    const args = fields['args']
    return nativeRun('workflow', {
      input: workflowInput(
        text('scriptPath') || text('name'),
        undefined,
        args === undefined ? undefined : JSON.stringify(args),
      ),
    })
  }
  return undefined
}
