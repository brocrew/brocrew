import type { AgentToolAnswer, AgentToolDefinition } from '@brobot2/runtime'
import { z } from 'zod'
import type { ThemeRail, ThemeRefused } from '../../shared/theme-library'
import { PERMANENCE_SAID } from '../../shared/refusals'
import { themeCatalogue } from '../../shared/themes/catalogue'
import type { ThemeStore } from './store'
import {
  activeThemeSaid,
  savedThemeSaid,
  setThemeSaid,
  themeRowSaid,
  THEME_TOOL_DESCRIPTIONS,
  type ThemeToolName,
} from './tool-words'

export type ThemeAgentStore = Pick<ThemeStore, 'refresh' | 'snapshot' | 'raw' | 'save' | 'set'>
type RefuseTheme = (
  rail: ThemeRail | 'malformed-request',
  detail: Readonly<Record<string, unknown>>,
) => AgentToolAnswer

const listInput = z
  .object({ id: z.string().optional(), catalogue: z.boolean().optional() })
  .strict()
const saveInput = z
  .object({
    theme: z.record(z.string(), z.unknown()),
    assets: z
      .array(
        z
          .object({ name: z.string(), path: z.string().optional(), base64: z.string().optional() })
          .strict(),
      )
      .optional(),
    activate: z.boolean().optional(),
    replace: z.boolean().optional(),
  })
  .strict()
const setInput = z.object({ id: z.string() }).strict()

// Settings and the catalogue are requested reads, printed once as field/value lines.
function fields(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((one, index) => fields(one, `${at}[${index}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, one]) => fields(one, at ? `${at}.${key}` : key))
  }
  return [`${at}: ${String(value)}`]
}

function refusalInWords(answer: AgentToolAnswer): AgentToolAnswer {
  const data = answer.structured
  const detail = data?.['detail']
  const problems =
    typeof detail === 'object' && detail !== null && 'problems' in detail
      ? detail.problems
      : undefined
  const lines = Array.isArray(problems)
    ? problems.flatMap((one: unknown) => {
        if (typeof one === 'string') return [one]
        if (
          typeof one !== 'object' ||
          one === null ||
          !('says' in one) ||
          typeof one.says !== 'string'
        )
          return []
        return ['at' in one && typeof one.at === 'string' ? `${one.at}: ${one.says}` : one.says]
      })
    : []
  const permanent = data?.['permanence'] === 'permanent'
  const clause = permanent
    ? `${PERMANENCE_SAID.permanent[0]!.toUpperCase()}${PERMANENCE_SAID.permanent.slice(1)}.${data?.['rail'] === 'malformed-request' ? ' Fix it and call again.' : ''}`
    : `This refusal holds ${PERMANENCE_SAID['while-this-holds']}.`
  return { ...answer, text: [answer.text, ...lines, clause].join(' ') }
}

export function themeAgentTools(
  getStore: () => ThemeAgentStore | undefined,
  actor: () => string,
  refuse: RefuseTheme,
  sayMalformed: (answer: AgentToolAnswer) => AgentToolAnswer = refusalInWords,
): (AgentToolDefinition & { readonly name: ThemeToolName })[] {
  const failed = (result: ThemeRefused): AgentToolAnswer =>
    refusalInWords(refuse(result.rail, { problems: result.problems }))
  const malformed = (problems: readonly string[]): AgentToolAnswer =>
    sayMalformed(refuse('malformed-request', { problems }))
  const invalid = (error: z.ZodError): AgentToolAnswer =>
    malformed(error.issues.map((one) => `${one.path.join('.')}: ${one.message}`))
  const unavailable = (): AgentToolAnswer =>
    failed({ outcome: 'refused', rail: 'theme-unknown', problems: [] })
  return [
    {
      name: 'list_themes',
      description: THEME_TOOL_DESCRIPTIONS.list_themes,
      input: listInput.shape,
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      call: async (args) => {
        const parsed = listInput.safeParse(args)
        if (!parsed.success) return invalid(parsed.error)
        const store = getStore()
        if (!store) return unavailable()
        const snapshot = await store.refresh()
        const theme = parsed.data.id === undefined ? undefined : store.raw(parsed.data.id)
        if (theme === null)
          return failed({ outcome: 'refused', rail: 'theme-unknown', problems: [] })
        const allSettings = parsed.data.catalogue === true ? themeCatalogue() : undefined
        const catalogue = allSettings
          ? {
              ...allSettings,
              ...(allSettings.background
                ? { background: allSettings.background.replace('png|jpg|webp', 'png|jpg') }
                : {}),
              limits: allSettings.limits.replace('PNG, JPEG or WebP', 'PNG or JPEG'),
            }
          : undefined
        const structured = {
          ...snapshot,
          ...(theme !== undefined ? { theme } : {}),
          ...(catalogue ? { catalogue } : {}),
        }
        return {
          structured,
          text: [
            activeThemeSaid(snapshot.active),
            ...snapshot.themes.map(themeRowSaid),
            ...(theme ? fields(theme) : []),
            ...(catalogue ? fields(catalogue) : []),
            ...(snapshot.reason ? [snapshot.reason] : []),
          ].join('\n'),
        }
      },
    },
    {
      name: 'save_theme',
      description: THEME_TOOL_DESCRIPTIONS.save_theme,
      input: saveInput.shape,
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      call: async (args) => {
        const parsed = saveInput.safeParse(args)
        if (!parsed.success) return invalid(parsed.error)
        const store = getStore()
        if (!store) return unavailable()
        const saved = await store.save(parsed.data, actor())
        return saved.outcome === 'refused'
          ? failed(saved)
          : {
              structured: { ...saved },
              text: [savedThemeSaid(saved.id, saved.version, saved.active), ...saved.warnings].join(
                ' ',
              ),
            }
      },
    },
    {
      name: 'set_theme',
      description: THEME_TOOL_DESCRIPTIONS.set_theme,
      input: setInput.shape,
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      call: async (args) => {
        const parsed = setInput.safeParse(args)
        if (!parsed.success) return invalid(parsed.error)
        const store = getStore()
        if (!store) return unavailable()
        const set = await store.set(parsed.data.id, actor())
        return set.outcome === 'refused'
          ? failed(set)
          : {
              structured: { ...set },
              text: setThemeSaid(set.active, set.previous),
            }
      },
    },
  ]
}
