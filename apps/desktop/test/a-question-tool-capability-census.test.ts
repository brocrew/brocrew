import { agentToolSourcePaths } from './helpers/agent-tool-source'
import { CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')

const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('394 · a question finds a person, and a permission never travels', () => {
  describe('§6 · the censuses', () => {
    it('⚑ no capability field is read in the tool layer, and this verb did not change that', () => {
      // ⚠️ **`347`'s standing census, re-asked because `394` added a verb that settles something on
      // another conversation's behalf.** The entitlement is the host's; the tool layer translates.
      const tools = codeOnly(sourceOf(join(mainRoot, 'runtime/tool-families'), 'questions.ts'))
      expect(tools).toMatch(/host\.answerQuestion\(/)
      // ⚑ **Every field this app has, key and column, derived and never listed by hand** — a list of
      // literals went on naming fields D-014 deleted, and an absence of a name nothing has is not a
      // measurement.
      const names = CAPABILITY_FIELDS.flatMap((field) => [field.key, field.column])
      expect(
        names.length,
        'no capability field was read, so this measures nothing',
      ).toBeGreaterThan(0)
      for (const file of agentToolSourcePaths(join(mainRoot, 'runtime'))) {
        const tools = codeOnly(readFileSync(file, 'utf8'))
        for (const name of names) expect(tools, name).not.toContain(name)
      }
      // ⛔ **The positive control, one file over**: the host reads a grant by the same spelling, so a
      // search that finds nothing in the tool layer is a search that can find something.
      const hostCode = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      expect(names.some((name) => hostCode.includes(name))).toBe(true)
    })
  })
})
