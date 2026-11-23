import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../../scripts/retire-landed-gates.mjs', import.meta.url))
const holds = readFileSync(
  new URL('../../../scripts/retained-gate-heads.txt', import.meta.url),
  'utf8',
)
  .trim()
  .split(/\r?\n/)

it('retires only newly landed disposable tips and preserves held or changed heads', () => {
  const root = mkdtempSync(join(tmpdir(), 'landed-gates-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'BroCrew',
    GIT_AUTHOR_EMAIL: '343827643+brocrew@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'BroCrew',
    GIT_COMMITTER_EMAIL: '343827643+brocrew@users.noreply.github.com',
  }
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const source = join(root, 'source')
  const origin = join(root, 'origin.git')
  const copy = join(root, 'copy')
  mkdirSync(source)
  try {
    git(source, 'init', '-b', 'main')
    const commit = (text: string): string => {
      writeFileSync(join(source, 'file'), text)
      git(source, 'add', 'file')
      git(source, 'commit', '-m', text)
      return git(source, 'rev-parse', 'HEAD')
    }
    const before = commit('before')
    const after = commit('after')
    const unlanded = commit('unlanded')
    git(root, 'init', '--bare', '--initial-branch=main', origin)
    git(source, 'remote', 'add', 'origin', origin)
    const tips = new Map([
      ['main', after],
      ['gate/prepare-new', after],
      ['gate/prepare-old', before],
      ['gate/prepare-unlanded', unlanded],
      ['gate/prepare-moved', after],
      ['gate/prepare-absent', after],
      ['source/live', after],
      ['release/shipped', after],
      ...holds.map((branch): [string, string] => [branch, after]),
    ])
    git(
      source,
      'push',
      'origin',
      ...[...tips].map(([branch, tip]) => `${tip}:refs/heads/${branch}`),
    )
    git(source, 'tag', 'keep-tag', after)
    git(source, 'push', 'origin', 'refs/tags/keep-tag')
    git(root, 'clone', origin, copy)
    git(origin, 'update-ref', 'refs/heads/gate/prepare-moved', unlanded, after)
    git(origin, 'update-ref', '-d', 'refs/heads/gate/prepare-absent', after)
    const output = execFileSync(process.execPath, [script, before, after], {
      cwd: copy,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(output).toContain(`Retired gate/prepare-new ${after}`)
    expect(output).toContain(`Moved, kept gate/prepare-moved ${unlanded}`)
    expect(output).toContain('Already absent gate/prepare-absent')
    const remaining = new Map(
      git(origin, 'for-each-ref', '--format=%(refname:strip=2) %(objectname)', 'refs/heads')
        .split('\n')
        .map((line): [string, string] => {
          const [branch, tip] = line.split(' ')
          return [branch!, tip!]
        }),
    )
    tips.delete('gate/prepare-new')
    tips.delete('gate/prepare-absent')
    tips.set('gate/prepare-moved', unlanded)
    expect(remaining).toEqual(tips)
    expect(holds).toHaveLength(18)
    expect(git(origin, 'rev-parse', 'refs/tags/keep-tag')).toBe(after)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
