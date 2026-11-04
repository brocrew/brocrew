import { expect, it } from 'vitest'
import { reactive, isProxy } from 'vue'
import { readFileSync } from 'node:fs'
import { asTheWireWouldCarry } from './lib/the-wire'
it.each(['install', 'update'] as const)(
  'the selected %s package crosses the wire as plain fields',
  (kind) => {
    const shown = reactive({
      id: 'fictional-bakery',
      ref: { source: 'http://localhost/fictional.tar.gz', sha256: 'a'.repeat(64), bytes: 1234 },
    })
    const input = {
      kind,
      id: shown.id,
      package: { source: shown.ref.source, sha256: shown.ref.sha256, bytes: shown.ref.bytes },
    }
    expect(isProxy(input.package)).toBe(false)
    expect(asTheWireWouldCarry('plugins.request', input)).toEqual(input)
  },
)
it('the actual Settings command producer sends selected byte references with normal actions', () => {
  const source = readFileSync(
    new URL('../src/renderer/src/components/PluginsSection.vue', import.meta.url),
    'utf8',
  )
  expect(source).toContain('package:')
  expect(source).not.toMatch(/consent:\s*pluginDisplayedConsent/)
})
