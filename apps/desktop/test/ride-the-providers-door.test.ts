import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'


const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')

describe('461 · ride the provider’s door', () => {
  const strip = (text: string): string =>
    text.replace(
      /\/\*\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      (match, keep: string | undefined) => keep ?? '',
    )
  const mainSource = (file: string): string =>
    strip(readFileSync(join(mainRoot, 'runtime', file), 'utf8'))


  describe('§2 · an approved plan settles nothing', () => {
    it('⛔ the plan-phase recorder is reached from four places and writes the plan phase only', () => {
      const host_ = mainSource('runtime-host.ts')
      expect(host_.match(/recordPlanPhase\(/g) ?? [], 'a fifth plan-phase call site').toHaveLength(
        4,
      )
      const recorder = host_.slice(
        host_.indexOf('private recordPlanPhase('),
        host_.indexOf('private recordPlanPhase(') + 700,
      )
      expect(recorder).toContain('startPlanMode')
      expect(recorder).toContain('endPlanMode')
      for (const forbidden of ['proposal', 'Proposal', 'createProject', 'bringItIntoExistence']) {
        expect(recorder, `recordPlanPhase reaches ${forbidden}`).not.toContain(forbidden)
      }
    })
  })


  describe('§4 · no surface restates a capability the descriptor owns', () => {
    const ipcSource = (): string => readFileSync(join(here, '../src/shared/runtime-ipc.ts'), 'utf8')

    it('⛔ the launch field no longer claims plan mode is Claude-only, or that Codex is unwired', () => {
      const text = ipcSource()
      const block = text.slice(
        text.indexOf('Start this session in PLAN MODE'),
        text.indexOf('planMode?: boolean'),
      )
      expect(block.length, 'the planMode docblock moved').toBeGreaterThan(200)
      for (const gone of [
        'Claude only for now',
        'now says `unwired`',
        'The Codex adapter still ignores the field',
      ]) {
        expect(block, `the stale sentence is back: ${gone}`).not.toContain(gone)
      }
      expect(block).toContain('capabilities.ts')
      expect(block).toContain('BOTH PROVIDERS')
    })

    it('⚠️ no file outside the capability descriptors calls Codex plan mode unwired', () => {
      const text = ipcSource()
      expect(text).not.toMatch(/Codex[^.]{0,80}no plan mode/i)
      expect(text).not.toMatch(/adapter still ignores/i)
    })
  })
})
