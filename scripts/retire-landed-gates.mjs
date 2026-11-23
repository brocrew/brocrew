import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [before, after] = process.argv.slice(2)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
git('cat-file', '-e', `${before}^{commit}`)
git('cat-file', '-e', `${after}^{commit}`)
git('merge-base', '--is-ancestor', before, after)
const held = new Set(
  readFileSync(new URL('./retained-gate-heads.txt', import.meta.url), 'utf8')
    .trim()
    .split(/\r?\n/),
)
const heads = git(
  'for-each-ref',
  '--format=%(objectname) %(refname:strip=3)',
  'refs/remotes/origin/gate/prepare-*',
)
const contains = (tip, commit) => {
  try {
    git('merge-base', '--is-ancestor', tip, commit)
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
}

console.log(`Landing range ${before}..${after}`)
for (const line of heads.split('\n').filter(Boolean)) {
  const [tip, branch] = line.split(' ')
  if (held.has(branch) || !contains(tip, after) || contains(tip, before)) continue
  const ref = `refs/heads/${branch}`
  try {
    git('push', '--porcelain', `--force-with-lease=${ref}:${tip}`, 'origin', `:${ref}`)
    console.log(`Retired ${branch} ${tip}`)
  } catch (error) {
    const current = git('ls-remote', '--heads', 'origin', ref).split(/\s/)[0]
    if (current === tip) throw error
    console.log(`${current ? 'Moved, kept' : 'Already absent'} ${branch} ${current}`)
  }
}
