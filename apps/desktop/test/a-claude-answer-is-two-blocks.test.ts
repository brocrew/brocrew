import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Current app tools use one prose part; historical multipart receipts retain their measured limits. */
const here = dirname(fileURLToPath(import.meta.url))
const LIB = join(here, '../src/renderer/src/lib/tool-answer.ts')
const PROBE = join(here, '../../../packages/runtime/smoke/claude-tool-answer-probe.smoke.ts')

/** ⛔ The sentences `675` made false — each is a claim no line of the file may make again. */
const RETIRED = [
  'no measurement of the equivalent on Claude',
  'the ordinary case on one of the two providers',
]

/** ⚠️ **A docblock wraps**, so the file is read as prose: every ` * ` line join becomes a space. */
const prose = (source: string): string => source.replace(/\n\s*\*\s*/g, ' ')

const claimsIn = (source: string): string[] =>
  RETIRED.filter((claim) => prose(source).includes(claim))

describe('tool-answer prose distinguishes current app tools from historical multipart receipts', () => {
  it('🔴 the retired claims are gone, and the measurement is named', () => {
    const source = prose(readFileSync(LIB, 'utf8'))
    expect(claimsIn(source)).toEqual([])
    expect(source).toContain('probe:claude-tool-answer')
    expect(source).toContain('App tools return one prose part; other receipts can carry several.')
    expect(source).toContain('forwarding to a model request is measured separately')
    // ⚑ The capture's own bound, quoted — what a loopback capture can and cannot say.
    expect(source).toContain(
      "This captures what the provider put in its model-bound request, not a hosted model's obedience to the text.",
    )
  })

  it('⛔ the planted control — a copy that still says them is caught', () => {
    const stale = `${readFileSync(LIB, 'utf8')}\n// and this app has no measurement of the equivalent on Claude, which is the ordinary case on one of the two providers`
    expect(claimsIn(stale)).toEqual(RETIRED)
  })

  it('⚑ the pointer holds — the cited probe exists, and its arm B is the prose then the JSON', () => {
    const probe = readFileSync(PROBE, 'utf8')
    expect(probe).toContain("'B-two-texts': { model: [PROSE, json]")
  })
})

/** Runtime contract comments and the historical probe distinguish current output from old receipts. */
const RUNTIME_TOOL_ANSWER = join(here, '../../../packages/runtime/src/tool-answer.ts')
const RUNTIME_AGENT_TOOLS = join(here, '../../../packages/runtime/src/agent-tools.ts')
const RETIRED_IN = new Map([
  [PROBE, ['no measurement of the equivalent on Claude', 'asserts it structurally and says so']],
  [RUNTIME_AGENT_TOOLS, ['Both providers deliver structured content alongside the text']],
])

describe('runtime comments distinguish current output from historical multipart receipts', () => {
  it('🔴 no runtime file makes a claim `675` retired', () => {
    for (const [file, retired] of RETIRED_IN) {
      const said = prose(readFileSync(file, 'utf8'))
      expect(
        retired.filter((claim) => said.includes(claim)),
        file,
      ).toEqual([])
    }
  })

  it('the runtime distinguishes app prose from historical and external receipts', () => {
    const said = prose(readFileSync(RUNTIME_TOOL_ANSWER, 'utf8'))
    expect(said).toContain('App tools emit one prose part.')
    expect(said).toContain('Historical and external receipts may contain more')
    expect(said).toContain(
      'dropped parts are counted so the retained answer does not look complete',
    )
  })

  it('⛔ the planted control — and the join is doing work: a wrapped claim is found only through it', () => {
    const planted =
      ' * the renderer says *"this app has no\n * measurement of the equivalent on Claude"* and it asserts it structurally and says so'
    expect(planted.includes('no measurement of the equivalent on Claude')).toBe(false)
    expect((RETIRED_IN.get(PROBE) ?? []).filter((claim) => prose(planted).includes(claim))).toEqual(
      RETIRED_IN.get(PROBE),
    )
  })
})
