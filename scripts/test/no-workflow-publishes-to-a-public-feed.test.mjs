import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { planOf, SANDBOX_FEED } from '../lib/update-rehearsal.mjs'

/**
 * ⛔ Nothing goes public without the owner's explicit yes, given in person. So no active workflow
 * may write a release anywhere but its own repository or the private rehearsal sandbox: not through
 * `gh release`, not through GitHub's API or a release action, not through electron-builder, and
 * not through the rehearsal's feed script, whose only GitHub feed is the sandbox. The public
 * rehearsal is held outside `.github/workflows/` until then.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')
const workflows = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), 'utf8') }))
const lines = workflows.flatMap(({ name, text }) =>
  text.split('\n').map((line, at) => ({ where: `${name}:${String(at + 1)}`, name, line })),
)

/** A tag filter as GitHub matches it: `*` is any run of characters but `/`, `[…]` one of them. */
const tagMatches = (pattern, tag) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(tag)

describe('⛔ no active workflow can publish to a public feed', () => {
  it('the walk finds the workflows that write releases', () => {
    expect(workflows.map((one) => one.name)).toEqual(
      expect.arrayContaining(['release.yml', 'windows.yml', 'macos.yml', 'update-rehearsal.yml']),
    )
  })

  it('nothing names a public rehearsal feed or its environment', () => {
    const naming = lines.filter(({ line }) =>
      /UPDATE_REHEARSAL_PUBLIC_REPO|update-rehearsal-public/.test(line),
    )
    expect(naming.map((one) => one.where)).toEqual([])
  })

  it('every gh release that writes names this repository, and release.yml’s is held to it', () => {
    const writes = lines.filter(({ line }) =>
      /\bgh release (create|upload|edit|delete)\b/.test(line),
    )
    expect(writes.length).toBeGreaterThan(0)
    const elsewhere = writes.filter(
      ({ name, line }) =>
        !line.includes('--repo "$GITHUB_REPOSITORY"') &&
        !(name === 'release.yml' && line.includes('--repo "$REPO"')),
    )
    expect(elsewhere.map((one) => `${one.where}: ${one.line.trim()}`)).toEqual([])
    // ⚑ release.yml's `$REPO` is its plan's repository, which it refuses unless it is this one.
    const release = workflows.find((one) => one.name === 'release.yml')?.text ?? ''
    expect(release).toContain('if [ "$RELEASE_REPO" != "$GITHUB_REPOSITORY" ]; then')
    expect(release).toContain('REPO: ${{ needs.plan.outputs.repo }}')
  })

  it('nothing else writes a release: no release action, no writing API call, no publishing build', () => {
    const others = lines.filter(
      ({ line }) =>
        /action-gh-release|actions\/create-release|upload-release-asset/.test(line) ||
        (/\bgh api\b/.test(line) &&
          /releases/.test(line) &&
          /(\s-X\s|--method|\s-f\s|\s-F\s|--field|--raw-field|--input)/.test(line)) ||
        (/electron-builder/.test(line) && /--publish\s+(?!never\b)/.test(line)),
    )
    expect(others.map((one) => `${one.where}: ${one.line.trim()}`)).toEqual([])
  })

  it('the rehearsal’s feed script publishes from one workflow, and only to the private sandbox', () => {
    const publishing = lines.filter(({ line }) =>
      /update-rehearsal-feed\.mjs (publish-a|release-b|sandbox-push)/.test(line),
    )
    expect([...new Set(publishing.map((one) => one.name))]).toEqual(['update-rehearsal.yml'])
    // ⚑ What a tag can plan: a local feed, or the sandbox. A public tag plans nothing.
    for (const tag of [
      'update-rehearsal-1',
      'update-rehearsal-local-1',
      'update-rehearsal-public-1',
    ]) {
      const plan = planOf(tag)
      if (plan.refused !== undefined) continue
      if (plan.feed.kind === 'github')
        expect(plan.feed).toEqual({ kind: 'github', repo: SANDBOX_FEED, private: true })
    }
    expect(planOf('update-rehearsal-public-1').refused).toBeDefined()
  })

  it('a public tag does not even start the rehearsal', () => {
    const rehearsal = workflows.find((one) => one.name === 'update-rehearsal.yml')?.text ?? ''
    const tags = /^ {4}tags: \[(.*)\]$/m
      .exec(rehearsal)?.[1]
      ?.split(',')
      .map((one) => one.trim().replace(/^'|'$/g, ''))
    expect(tags).toBeDefined()
    expect(tags?.some((one) => tagMatches(one, 'update-rehearsal-public-1'))).toBe(false)
    // ⚑ The control: the tags it is for still start it.
    for (const tag of ['update-rehearsal-3', 'update-rehearsal-local-2']) {
      expect(
        tags?.some((one) => tagMatches(one, tag)),
        tag,
      ).toBe(true)
    }
  })

  it('every lane on a GitHub feed reads it as private', () => {
    const public_ = lines.filter(
      ({ line }) => line.includes('--feed-github') && !line.includes('--feed-private'),
    )
    expect(public_.map((one) => one.where)).toEqual([])
  })

  it('the public rehearsal is held, outside the active workflows', () => {
    const held = join(ROOT, 'scripts', 'update-rehearsal', 'held', 'update-rehearsal-public.yml')
    expect(existsSync(held)).toBe(true)
    expect(readFileSync(held, 'utf8')).toMatch(/^# HELD: /)
  })
})
