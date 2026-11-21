import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * One conversation is drawn by one component, and one provider name by one component, wherever
 * the window shows them. These read the renderer's sources, so a list that grows its own drawing
 * again, or a template that prints a provider's id, fails here before anyone sees it.
 */
const renderer = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src')
const components = join(renderer, 'components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? vueFiles(join(dir, entry.name))
      : entry.name.endsWith('.vue')
        ? [join(dir, entry.name)]
        : [],
  )
}

/** The template part of a single-file component. */
function templateOf(path: string): string {
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf('<template>')
  const end = text.lastIndexOf('</template>')
  return start === -1 ? '' : text.slice(start, end)
}

/** Every list or bar that shows a conversation, and so mounts the shared row. */
const CONVERSATION_SURFACES = [
  'SideRail.vue',
  'SessionLibraryRow.vue',
  'ResumableSessions.vue',
  'CommandPalette.vue',
  'ForestCard.vue',
  'TeamWorkspace.vue',
  'WorkingTogether.vue',
  'SessionHeader.vue',
  'AttentionQueue.vue',
]

describe('one conversation row', () => {
  it.each(CONVERSATION_SURFACES)('%s draws its conversations with ConversationRow', (file) => {
    expect(templateOf(join(components, file))).toContain('<ConversationRow')
  })

  it('no surface draws a conversation plate of its own beside the shared row', () => {
    const own = CONVERSATION_SURFACES.flatMap((file) =>
      [...templateOf(join(components, file)).matchAll(/<AgentState\b[^>]*>/g)].map(
        (match) => `${file}: ${match[0]}`,
      ),
    )
    // The team card's plate stands for an agent profile, not for one of its conversations.
    expect(own).toEqual([
      'TeamWorkspace.vue: <AgentState size="card" v-bind="member.facets" :label="member.heading" />',
    ])
  })
})

describe('one provider label', () => {
  it('no template prints a provider field as it is; ProviderLabel names it', () => {
    const printed: string[] = []
    for (const path of vueFiles(renderer)) {
      if (path.endsWith('ProviderLabel.vue')) continue
      for (const match of templateOf(path).matchAll(/\{\{([^}]*?)([\w\])?!]+)\.provider\s*\}\}/g)) {
        const receiver = /([A-Za-z_][\w]*)[\])?!]*$/.exec(match[2]!)?.[1] ?? ''
        // A constant such as AUTHOR.provider is a word for the provider as an author, not its id.
        if (receiver === receiver.toUpperCase()) continue
        printed.push(`${relative(renderer, path)}: ${match[0]}`)
      }
    }
    expect(printed).toEqual([])
  })

  it('the label reads the name from the Client API catalogue', () => {
    const source = readFileSync(join(renderer, 'composables/useProviderLabel.ts'), 'utf8')
    expect(source).toContain('useProviderNames(useClientApi())')
  })
})
