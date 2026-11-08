import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const version = JSON.parse(
  readFileSync('apps/desktop/src/main/providers/claude/claude-code-tested.json', 'utf8'),
).newest
const prefix = join(process.env.RUNNER_TEMP, 'claude-code')
execFileSync(
  'npm',
  [
    'install',
    '--prefix',
    prefix,
    '--no-audit',
    '--no-fund',
    `@anthropic-ai/claude-code@${version}`,
  ],
  { stdio: 'inherit' },
)
const program = join(prefix, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe')
if (!existsSync(program))
  throw new Error('The tested Claude Code installation has no native executable')
appendFileSync(process.env.GITHUB_OUTPUT, `program=${program}\n`)
console.log(`Claude Code ${version}: ${program}`)
