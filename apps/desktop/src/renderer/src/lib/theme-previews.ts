import TOKENS from '../assets/tokens.css?raw'
import type { ThemeReading } from '../../../shared/theme-library'
import { DEFAULT_SEEDS } from '../../../shared/themes/derive'
import { THEME_CUSTOM_PROPERTIES, themeCss } from '../../../shared/themes/css'
import { HELD_TOKENS, overridableIn } from '../../../shared/themes/schema'
import { readingAssetUrl } from './window-theme'

const previewScope = (id: string): string => `[data-theme-preview='${id}']`

const previewContent = (id: string): string => `${previewScope(id)} [data-preview-zone='content']`

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

const PUT_BACK = [...overridableIn('content'), ...HELD_TOKENS]

const CLASSIC_FRAME_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  PUT_BACK.map((name) => [name, ROOT.get(`--${name}`) ?? 'initial']),
)

const CLASSIC_CONTENT_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  PUT_BACK.map((name) => [name, LIGHT.get(`--${name}`) ?? ROOT.get(`--${name}`) ?? 'initial']),
)

const block = (selector: string, lines: readonly string[]): string =>
  `${selector} {\n${lines.join('\n')}\n}\n`
const tokens = (values: Readonly<Record<string, string>>): string[] =>
  Object.entries(values).map(([name, value]) => `  --${name}: ${value};`)

const FRAME = `var(--frame-paper, ${DEFAULT_SEEDS.frame.paper})`

const PAGE =
  `color-mix(in oklab, var(--content-ink, ${DEFAULT_SEEDS.content.ink}) ` +
  `var(--page-depth, ${DEFAULT_SEEDS.page}%), var(--content-paper, ${DEFAULT_SEEDS.content.paper}))`

const page = (theme: NonNullable<ThemeReading['theme']>): string => {
  const tuned = theme.tokens?.content
  return tuned?.['chat-bg'] ?? tuned?.['paper-bg'] ?? PAGE
}

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
