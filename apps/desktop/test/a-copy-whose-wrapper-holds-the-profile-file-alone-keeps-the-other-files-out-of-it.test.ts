import { describe, expect, it } from 'vitest'
import {
  FILES_INTRO_PROFILE_ONLY,
  NOT_IN_THIS_COPY,
  requestTabs,
} from '../src/renderer/src/lib/request-order'
import { sizeOf, type ProviderSnapshot, type SnapshotPart } from '../src/shared/provider-snapshots'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'

/**
 * The popup's Files tab, read off a stored Codex copy. Codex wraps the AGENTS files it was given in
 * one message: a copy captured with the workspace's own file holds both of BroBot's marks, and one
 * captured without it holds the profile's mark alone. The second is drawn as it was sent: the rest
 * of the wrapper is its closing, and the person's other files come after every part of the copy.
 */

const PROFILE = '⟨BroBot’s part: the AGENTS file it writes for this profile⟩'
const WORKSPACE = '⟨BroBot’s part: the workspace’s AGENTS.md⟩'
const HISTORICAL_INTRO =
  'One user message wraps the instruction files. Each file stays inside that wrapper, followed by the environment.'

function part(id: string, text: string): SnapshotPart {
  return { id, title: id, where: 'user-message', when: 'first-message', text, ...sizeOf(text) }
}

function codexCopy(wrapper: string): ProviderSnapshot {
  const parts = [
    part('codex.agents-wrapper', wrapper),
    part('codex.environment', '<environment_context>\n</environment_context>'),
  ]
  return {
    provider: 'codex',
    version: '0.160.0',
    label: 'as of Codex 0.160.0',
    model: 'gpt-5.5',
    shape: 'functions',
    notes: [],
    parts,
    ...sizeOf(parts.map((one) => one.text).join('\n')),
  }
}

/** The Files tab: its intro, its items as their kind and key or a line's words, and its closing. */
function filesTab(wrapper: string): { intro: string; items: string[]; closing: string } {
  const base = givenAnswer()
  const given = givenAnswer({
    provider: 'codex',
    providerParts: { ...base.providerParts, snapshot: codexCopy(wrapper) },
  })
  const tab = requestTabs(given, [], true, () => 'then').find(
    (one) => one.key === 'files-and-folder',
  )
  if (tab === undefined) throw new Error('no Files tab')
  const closing = tab.items.find(
    (item) => item.kind === 'row' && item.key === 'part:codex.agents-wrapper:closing',
  )
  const piece = closing?.kind === 'row' ? closing.pieces[0] : undefined
  return {
    intro: tab.intro,
    items: tab.items.map((item) =>
      item.kind === 'row' ? `row ${item.key}` : `${item.kind} ${item.text}`,
    ),
    closing: piece?.kind === 'text' ? piece.text : '',
  }
}

const PROFILE_FILE = 'row file:/Users/someone/provider-homes/designer/brobot-instructions.md'
const OTHER_FILE = 'row file:/Users/someone/work/bakery/CONTRIBUTING.md'

describe('a stored copy of Codex’s AGENTS wrapper, in the popup’s Files tab', () => {
  it('⚑ with both files, is drawn as before: the other files between the two', () => {
    const tab = filesTab(
      `# AGENTS.md instructions for ⟨folder⟩\n\n<INSTRUCTIONS>\n${PROFILE}\n\n--- project-doc ---\n\n${WORKSPACE}\n</INSTRUCTIONS>`,
    )
    expect(tab.intro).toBe(HISTORICAL_INTRO)
    expect(tab.items).toEqual([
      'row part:codex.agents-wrapper:opening',
      expect.stringMatching(/^join /),
      PROFILE_FILE,
      'row part:codex.agents-wrapper:between',
      OTHER_FILE,
      'row part:codex.agents-wrapper:closing',
      'row part:codex.environment',
    ])
  })

  it('⛔ with the profile’s file alone, keeps the other files out of it, after the copy, and says so', () => {
    const tab = filesTab(`# AGENTS.md instructions\n\n<INSTRUCTIONS>\n${PROFILE}\n</INSTRUCTIONS>`)
    expect(tab.intro).toBe(FILES_INTRO_PROFILE_ONLY)
    expect(tab.items).toEqual([
      'row part:codex.agents-wrapper:opening',
      expect.stringMatching(/^join /),
      PROFILE_FILE,
      'row part:codex.agents-wrapper:closing',
      'row part:codex.environment',
      `boundary ${NOT_IN_THIS_COPY}`,
      OTHER_FILE,
    ])
    // ⚑ The wrapper's own closing is drawn whole, and nothing stands in for a file it did not hold.
    expect(tab.closing.trim()).toBe('</INSTRUCTIONS>')
    expect(tab.items.some((one) => one.includes(':between'))).toBe(false)
  })
})
