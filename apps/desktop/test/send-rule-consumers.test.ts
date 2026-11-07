import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(join(here, '..', rel), 'utf8')

const COMPOSER = 'src/renderer/src/components/PromptComposer.vue'
const STORE = 'src/renderer/src/lib/session-store.ts'
const WIRE = 'src/main/runtime/ipc.ts'
const SHARED = 'src/shared/runtime-ipc.ts'
const HOST = 'src/main/runtime/runtime-host.ts'

function codeOf(source: string): string {
  let inBlock: '*/' | '-->' | null = null
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock !== null) {
          if (!rest.startsWith(inBlock)) continue
          at += inBlock.length - 1
          inBlock = null
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = '*/'
          at += 1
          continue
        }
        if (rest.startsWith('<!--')) {
          inBlock = '-->'
          at += 3
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}

describe('223 §5 · every consumer of the send rule asks it', () => {
  it('⛔ the SHARED predicate is the only definition of "there is something to send"', () => {
    const shared = codeOf(read(SHARED))
    expect(shared).toContain('export function hasSomethingToSend(')
    expect(shared).toMatch(
      /hasSomethingToSend\([^)]*\)[^{]*\{\s*return text\.trim\(\) !== '' \|\| attached > 0/,
    )
  })

  it('⛔ the BUTTON asks it — the consumer 223 added, through `canSend`', () => {
    const composer = codeOf(read(COMPOSER))

    const send = /<button\b[^>]*?data-cy="send-prompt"/s.test(composer)
      ? composer.slice(composer.indexOf('class="send-button"'))
      : ''
    expect(send, 'the send button is no longer recognisable in this file').not.toBe('')
    const tag = send.slice(0, send.indexOf('>'))
    expect(tag, 'the button stopped reading the shared predicate').toContain(
      ':disabled="!canSendNow"',
    )

    expect(composer).toMatch(
      /const canSendNow = computed\(\s*\(\) =>\s*!voiceActive\.value && canSend\(text\.value, props\.state, blockedWords\.value, staged\.value\.length\),?\s*\)/,
    )

    expect(composer).toMatch(
      /export function canSend\([\s\S]*?hasSomethingToSend\(text, attached\)/,
    )

    expect(tag, 'the tooltip stopped being derived from the answer').toContain(
      ':title="sendRefusal ??',
    )
    expect(composer).toMatch(
      /const sendRefusal = computed<string \| null>\(\(\) => \{\s*if \(voiceActive\.value\) return '[^']*'\s*if \(canSendNow\.value\) return null/,
    )
    expect(composer).toContain('return nothingToSendYet(props.canAttach)')
  })

  it('⛔ the BUSY SELECTOR asks it — the consumer 234 §2 found still spelling it out', () => {
    const composer = codeOf(read(COMPOSER))
    expect(composer).toMatch(
      /const busyChoices = computed\(\(\) => props\.state === 'busy' && canSendNow\.value\)/,
    )
    expect(composer).toContain('<template v-if="busyChoices">')
    expect(composer).toContain('<template v-else-if="busyChoices && props.hasQueued">')
    expect(composer).toContain('<template v-else-if="busyChoices">')
    for (const spelling of ["text.trim() !== ''", "text.value.trim() !== ''"]) {
      expect(
        composer.includes(spelling),
        `a branch spells the send rule out (\`${spelling}\`) instead of asking \`canSend\``,
      ).toBe(false)
    }
  })

  it('⛔ the HOST asks it — the gate every turn passes (234 §3, from 228 L1)', () => {
    const host = codeOf(read(HOST))
    expect(host).toMatch(
      /if \(!hasSomethingToSend\(content\.text, content\.attached\)\) throw new Error\(NOTHING_TO_SEND\)/,
    )
    const calls = host.match(/this\.assertCanTakeTurn\(/g) ?? []
    expect(calls.length, 'a call site was added or removed — check it hands over its content').toBe(
      7,
    )
    expect(
      host.match(/this\.assertCanTakeTurn\(session, '(?:send|queue)', \{/g) ?? [],
      'a call site stopped handing over its content — the gate would be asking about a default',
    ).toHaveLength(calls.length - 1)
    expect(host.match(/this\.assertCanTakeTurn\(targetSession, 'queue', \{/g)).toHaveLength(1)
    expect(host).toMatch(
      /this\.assertCanTakeTurn\(targetSession, 'queue', \{\s*text: original\.event\.text,\s*attached: original\.event\.attachments\?\.length \?\? 0,\s*from: this\.originOf\(by\)/,
    )

    expect(host).toMatch(
      /assertCanTakeTurn\(session, 'send', \{\s*text: going\.map\(\(\{ queued \}\) => queued\.text\)\.join\('\\n\\n'\),\s*attached: going\.reduce\(\(all, \{ handed \}\) => all \+ handed\.paths\.length, 0\),/,
    )
  })

  it('⛔ the renderer STORE asks it — the early-out that keeps a dead send off the wire', () => {
    expect(codeOf(read(STORE))).toMatch(
      /if \(!hasSomethingToSend\(text, attachments\.length\)\) return true/,
    )
  })

  it('⛔ the WIRE asks it — every send-shaped verb and the go-ahead (221 §1, 234 §3, 735)', () => {
    const wire = codeOf(read(WIRE))
    expect(wire).toMatch(/\.refine\(\(command\) => hasSomethingToSend\(command\.text,/)
    for (const verb of ['send', 'sendInterrupting', 'queueMessage', 'startAndSend']) {
      expect(wire, `${verb} left the shaped schema`).toContain(`sendShaped('${verb}')`)
    }
    expect(wire).toMatch(/\.refine\(\(text\) => hasSomethingToSend\(text, 0\), NOTHING_TO_SEND\)/)
    expect(wire).toContain('text: goAheadText')
  })

  it('⚑ …and the census is reading real files, not empty strings', () => {
    for (const rel of [COMPOSER, STORE, WIRE, SHARED, HOST]) {
      const code = codeOf(read(rel))
      expect(code.length, `${rel} came back empty`).toBeGreaterThan(2_000)
      const contaminated = `${read(rel)}\n// hasSomethingToSend(decoy, 0)`
      expect(contaminated).toContain('// hasSomethingToSend(decoy, 0)')
      expect(codeOf(contaminated).trim(), rel).toBe(code.trim())
      expect(codeOf(`${read(rel)}\nconst extra = hasSomethingToSend(decoy, 0)`)).toContain(
        'const extra = hasSomethingToSend(decoy, 0)',
      )
    }
    for (const mention of [
      '// hasSomethingToSend(text, 0)',
      '/** hasSomethingToSend(text, 0) */',
      '<!-- hasSomethingToSend(text, 0) -->',
    ]) {
      expect(codeOf(mention).trim(), `${mention} survived the stripper`).toBe('')
    }
    expect(codeOf('const x = hasSomethingToSend(a, b)')).toContain('hasSomethingToSend')
  })
})
