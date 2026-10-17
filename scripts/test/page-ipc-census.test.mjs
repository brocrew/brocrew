import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { censusOf, pageTemplatesIn, typescriptAt } from '../lib/page-ipc-census.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

// ⚑ DERIVED, never listed: every smoke script whose text names the bridge. A new smoke joins the
// census by existing; one that stops naming the bridge leaves it by not.
const files = ['scripts', 'scripts/lib']
  .flatMap((directory) =>
    readdirSync(join(root, directory))
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => `${directory}/${name}`),
  )
  .filter((file) => file !== 'scripts/lib/page-ipc-census.mjs')
  .filter((file) => /\bwindow\.api\b/.test(readFileSync(join(root, file), 'utf8')))

// 🔴 The planted control (rule 12): SEVEN drifts across THREE pages — two stale reads in ONE page,
// so a census that stopped at the first finding per page is caught — beside reads that exist, a
// correct compare, and a DOM read the page's own lib cannot type, none of which may be reported.
// ⚠️ `because` is the field `611` retired and `660` died on; `aFieldNoTypeWillEverHave665` is the
// plant that stays stale when a future dispatch adds some other field back (rule 12's second half).
const planted = [
  {
    file: 'planted',
    line: 1,
    body: [
      'const walked = await window.api.runtime.decisionsForAPerson()',
      'const row = walked.rows[0]',
      'const went = row.request.went',
      'const because = row.request.because',
      "const dom = document.querySelector('[data-cy=x]').dataset",
      'return { went, because, dom, stale: row.request.aFieldNoTypeWillEverHave665 }',
    ].join('\n'),
  },
  {
    file: 'planted',
    line: 20,
    body: [
      'const { identities } = await window.api.runtime.agentIdentities()',
      'const { aFieldNoTypeWillEverHave665 } = identities[0]',
      'const info = await window.api.getAppInfo()',
      'return [identities[0].slug, aFieldNoTypeWillEverHave665, info.db.aFieldNoTypeWillEverHave665]',
    ].join('\n'),
  },
  {
    // ⚑ The INPUT side and the comparison: a key the bridge does not take, a value outside a field's
    // union, and a literal no answer can ever carry — beside a correct call and a correct compare.
    file: 'planted',
    line: 40,
    body: [
      "const ack = await window.api.runtime.respondPermission({ sessionId: 's', requestId: 'r', decision: { outcome: 'allow' } })",
      "const taken = ack.outcome === 'taken'",
      "const never = ack.outcome === 'takenNever665'",
      "await window.api.runtime.createSession({ provider: 'codex', aKeyNoInputWillEverTake665: 1 })",
      "await window.api.runtime.createSession({ provider: 'codex', approvalMode: 'askNever665' })",
      'return [taken, never]',
    ].join('\n'),
  },
]

let census
beforeAll(() => {
  census = censusOf(root, files, planted)
}, 180_000)

describe('665 · every field a smoke reads off the bridge exists on the type the bridge declares', () => {
  it('🔴 the planted control: seven drifts in three pages, all found; nothing else from them', () => {
    const fromPlants = census.findings.filter((finding) => finding.file === 'planted')
    expect(fromPlants.map(({ read, type }) => ({ read, type }))).toEqual([
      { read: 'row.request.because', type: 'RequestOnlyAPersonCanSettle' },
      { read: 'row.request.aFieldNoTypeWillEverHave665', type: 'RequestOnlyAPersonCanSettle' },
      { read: 'aFieldNoTypeWillEverHave665', type: 'AgentIdentity' },
      // ⚑ A member of the bridge OUTSIDE `runtime` — typed only because the page's own declaration is.
      // ⚠️ And a zod-INFERRED one: `AppInfo`'s field declarations live in zod's types, not ours.
      {
        read: 'info.db.aFieldNoTypeWillEverHave665',
        type: '{ migrationsApplied: number; providerSessionCount: number; }',
      },
      // ⚑ **742 · re-aimed, not stripped**: `respondPermission` answers `ProviderAnswerAck` now (`739`
      // F-6 — the provider may not have taken it yet), and the literal is still in none of its arms.
      { read: "ack.outcome === 'takenNever665'", type: 'ProviderAnswerAck' },
      // ⚑ **716 · the input is `createSession`'s generic parameter now** — `CreateSessionInput` and
      // the opt-in that asks for a refusal answered (`710` F-7). Both drifts are still found, key by
      // key: that is what this pair measures, and why the bridge has ONE signature, not two overloads.
      {
        read: 'aKeyNoInputWillEverTake665: 1',
        type: 'CreateSessionInput & { readonly answerARefusal?: undefined; }',
      },
      {
        read: "approvalMode: 'askNever665'",
        type: 'CreateSessionInput & { readonly answerARefusal?: undefined; }',
      },
    ])
  })

  it('⛔ covers the smokes that drive the bridge, and cannot go quiet on a page it could not read', () => {
    for (const smoke of [
      'scripts/ui-live-smoke.mjs',
      'scripts/resume-live-smoke.mjs',
      'scripts/packaged-smoke.mjs',
    ]) {
      expect(files).toContain(smoke)
    }
    for (const file of files) {
      expect(census.pages.filter((page) => page.file === file).length, file).toBeGreaterThan(0)
    }
    // A page that does not parse types nothing: it is refused, never skipped.
    expect(census.unparsed).toEqual([])
    expect(census.syntactic).toEqual([])
  })

  it('⚑ sorts a candidate by what it IS: a page, refused page code, or prose that names the bridge', () => {
    const ts = typescriptAt(root)
    const source = [
      "await cdp.evaluate('return window.api.getAppInfo().then(() => 1)')",
      'const probe = `return window.api.runtime.listResumable(`',
      "await cdp.evaluate('return window.api.runtime.close(' + id + ')')",
      "throw new Error('placed through window.api.runtime.createSession rather than the surface')",
      "await evaluateInPage(port, 'return window.api.runtime.close(' + id + ')')",
    ].join('\n')
    const found = pageTemplatesIn(ts, 'sorted', source)
    expect(found.pages.map((one) => one.line)).toEqual([1])
    // ⚑ Line 5: every page executor counts, whatever follows `evaluate` in its name.
    expect(found.unparsed.map((one) => one.line)).toEqual([2, 3, 5])
    expect(found.prose.map((one) => one.line)).toEqual([4])
  })

  it('🔴 no smoke reads a field its bridge does not declare', () => {
    expect(census.findings.filter((finding) => finding.file !== 'planted')).toEqual([])
  })
})
