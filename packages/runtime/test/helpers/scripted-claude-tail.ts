import { query } from '@anthropic-ai/claude-agent-sdk'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { alive } from './process-alive'
import { watchClaudeChild } from '../../src/claude/claude-child'
import { anthropicEvents, sseOf, toolResultsIn } from '../../../../scripts/lib/scripted-claude.mjs'

export async function checkClaudeTail(
  cleanup: (folders: readonly string[]) => Promise<void>,
): Promise<void> {
  const binary = process.env.BROCREW_CLAUDE_FIXTURE_BINARY
  if (!binary) throw new Error('Set BROCREW_CLAUDE_FIXTURE_BINARY to the installed fixture CLI')
  const folder = mkdtempSync(join(tmpdir(), 'claude-tail-'))
  const pidFile = join(folder, 'tail.pid')
  const model = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (!request.url?.startsWith('/v1/messages')) {
        response.writeHead(404).end()
        return
      }
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ input_tokens: 10 }))
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const reply = toolResultsIn(body).has('tail-command')
        ? { kind: 'text' as const, text: 'The fictional command ran.' }
        : {
            kind: 'tool_use' as const,
            id: 'tail-command',
            name: 'Bash',
            input: {
              command: `tail -f /dev/null >/dev/null 2>&1 & echo $! > '${pidFile}'`,
              description: 'Start the cleanup fixture',
            },
          }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sseOf(anthropicEvents(body.model, reply, 'msg_tail_fixture')))
    })
  })
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
  const port = (model.address() as { port: number }).port
  const child = watchClaudeChild()
  let cliPid: number | undefined
  const run = query({
    prompt: 'Run the fictional cleanup command.',
    options: {
      pathToClaudeCodeExecutable: binary,
      cwd: folder,
      tools: ['Bash'],
      allowedTools: ['Bash'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      env: {
        ...process.env,
        HOME: folder,
        CLAUDE_CONFIG_DIR: join(folder, 'config'),
        ANTHROPIC_API_KEY: 'sk-ant-fictional-cleanup-key',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
      },
      spawnClaudeCodeProcess: (options) => {
        const spawned = child.spawn(options)
        cliPid = child.pid
        return spawned
      },
    },
  })
  let tail: number | undefined
  try {
    let result = false
    for await (const message of run) {
      if (message.type === 'result') {
        expect(message.is_error).toBe(false)
        result = true
        break
      }
    }
    expect(result).toBe(true)
    expect(existsSync(pidFile)).toBe(true)
    tail = Number(readFileSync(pidFile, 'utf8').trim())
    expect(tail).toBeGreaterThan(0)
    console.log(JSON.stringify({ cli: binary, cliPid, tail, aliveBeforeClose: alive(tail) }))
    run.close()
    await child.close()
    await child.quiesced
    const parent = Number(
      execFileSync('ps', ['-o', 'ppid=', '-p', String(tail)], { encoding: 'utf8' }).trim(),
    )
    expect(parent).toBe(1)
    console.log(JSON.stringify({ tail, parent, cwd: folder, aliveAfterGroupClose: alive(tail) }))
    await cleanup([folder])
    await vi.waitFor(() => expect(alive(tail!)).toBe(false), { timeout: 3000 })
    console.log(JSON.stringify({ cli: binary, tail, aliveAfterClose: alive(tail) }))
  } finally {
    run.close()
    await child.close()
    if (tail !== undefined && alive(tail)) process.kill(tail, 'SIGKILL')
    await new Promise<void>((resolve, reject) =>
      model.close((error) => (error ? reject(error) : resolve())),
    )
    rmSync(folder, { recursive: true, force: true })
  }
}
