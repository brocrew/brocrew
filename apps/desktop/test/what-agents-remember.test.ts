import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema } from '@brobot2/shared'
import { composeProfileBundle } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('PE-001 · the memory guidance an agent receives', () => {
  for (const provider of providerSchema.options) {
    it(`${provider}: project, transferable, explicit-save and finish guidance reach the provider`, () => {
      const root = mkdtempSync(join(tmpdir(), 'brobot-pe001-'))
      roots.push(root)
      const home = join(root, 'home')
      const cwd = join(root, 'work')
      mkdirSync(home)
      mkdirSync(cwd)

      // The memory line is in the profile's file; the conversation's own text carries none.
      const bundle = publishProfileBundle(
        provider,
        home,
        composeProfileBundle({ configured: null }),
      )
      expect(bundle.ok).toBe(true)
      const read = readSessionInstructions({ provider, cwd, providerHome: home, bundle })
      const delivered =
        provider === 'claude'
          ? (read.instructions.composed ?? '')
          : readFileSync(bundle.path, 'utf8')

      // The core says when memory may be saved; the remember skill carries the rest.
      expect(delivered).toContain(
        "Keep the person's standing wishes in your own notes and, when permitted, tested lessons in saved methods; keep task facts separate.",
      )
      expect(delivered).not.toContain('Not this piece of work’s details')
    })
  }
})
