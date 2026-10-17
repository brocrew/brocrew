/**
 * The stylesheet behind the Themes section's small previews: one set of blocks per theme, scoped
 * to its card. A preview has two zones, like the window: its frame (the card's preview root) and
 * its conversation (`data-preview-zone='content'`). Each first puts back what a theme can change —
 * every setting unset, every hand-tunable colour token at the app's own value for that zone — so a
 * preview shows its own theme and never the one the window wears. Then its theme writes its own,
 * frame tokens on the root and content tokens on the conversation, and the two colours the window
 * works out for its frame and its page.
 */
import TOKENS from '../assets/tokens.css?raw'
import type { ThemeReading } from '../../../shared/theme-library'
import { DEFAULT_SEEDS } from '../../../shared/themes/contrast'
import { THEME_CUSTOM_PROPERTIES, themeCss } from '../../../shared/themes/css'
import { HELD_TOKENS, overridableIn } from '../../../shared/themes/schema'
import { readingAssetUrl } from './window-theme'

/** The selector a theme's preview sits under. */
export const previewScope = (id: string): string => `[data-theme-preview='${id}']`

/** The selector of a preview's conversation, its content zone. */
export const previewContent = (id: string): string =>
  `${previewScope(id)} [data-preview-zone='content']`

/** The declarations of the first rule whose selector starts a line with `selector`. */
function declarationsOf(css: string, selector: RegExp): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = new RegExp(`^${selector.source}[^{]*\\{([^}]*)\\}`, 'm').exec(source)
  const out = new Map<string, string>()
  for (const part of (rule?.[1] ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at > 0)
      out.set(
        part.slice(0, at).trim(),
        part
          .slice(at + 1)
          .trim()
          .replace(/\s+/g, ' '),
      )
  }
  return out
}

const ROOT = declarationsOf(TOKENS, /:root(?=\s*\{)/)
const LIGHT = declarationsOf(TOKENS, /\[data-chat-theme='light'\],/)

/** Each hand-tunable token as the app's own frame has it: the root's value. */
/** Every token a preview puts back to the app's own: those a theme can set, and those it can't yet. */
const PUT_BACK = [...overridableIn('content'), ...HELD_TOKENS]

export const CLASSIC_FRAME_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  PUT_BACK.map((name) => [name, ROOT.get(`--${name}`) ?? 'initial']),
)

/** Each hand-tunable token as the app's own content scope has it: its own value, else the root's. */
export const CLASSIC_CONTENT_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  PUT_BACK.map((name) => [name, LIGHT.get(`--${name}`) ?? ROOT.get(`--${name}`) ?? 'initial']),
)

const block = (selector: string, lines: readonly string[]): string =>
  `${selector} {\n${lines.join('\n')}\n}\n`
const tokens = (values: Readonly<Record<string, string>>): string[] =>
  Object.entries(values).map(([name, value]) => `  --${name}: ${value};`)

/** The window's frame under a theme: its frame paper, as tokens.css paints it. */
const FRAME = `var(--frame-paper, ${DEFAULT_SEEDS.frame.paper})`

/** The window's page under a theme: its page paper, as tokens.css works it out. */
const PAGE =
  `color-mix(in oklab, var(--content-ink, ${DEFAULT_SEEDS.content.ink}) ` +
  `var(--page-depth, ${DEFAULT_SEEDS.page}%), var(--content-paper, ${DEFAULT_SEEDS.content.paper}))`

/** The page a theme's conversation paints: a hand-tuned page colour if it has one, else its paper. */
const page = (theme: NonNullable<ThemeReading['theme']>): string => {
  const tuned = theme.tokens?.content
  return tuned?.['chat-bg'] ?? tuned?.['paper-bg'] ?? PAGE
}

/** One preview's CSS. Classic, which has no theme, is the putting back alone: the app's own look. */
export function previewCss(id: string, reading: ThemeReading | null): string {
  const scope = previewScope(id)
  const content = previewContent(id)
  const back =
    block(scope, [
      ...THEME_CUSTOM_PROPERTIES.map((p) => `  ${p}: initial;`),
      '  --preview-frame: initial;',
      '  --preview-page: initial;',
      ...tokens(CLASSIC_FRAME_TOKENS),
    ]) + block(content, tokens(CLASSIC_CONTENT_TOKENS))
  if (!reading?.theme) return back
  return (
    back +
    themeCss(reading.theme, {
      scope,
      contentScope: content,
      assetUrl: readingAssetUrl(reading),
    }) +
    block(scope, [`  --preview-frame: ${FRAME};`]) +
    block(content, [`  --preview-page: ${page(reading.theme)};`])
  )
}
