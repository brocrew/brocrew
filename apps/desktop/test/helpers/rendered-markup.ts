import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

/** Server-renders a component with these props to its markup. */
export function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(component as never, props) }))
}

/** What a person reads: the markup without the comments the templates carry. */
export function shown(markup: string): string {
  return markup.replace(/<!--[\s\S]*?-->/g, '')
}

/** The text with its HTML entities turned back into characters. */
export function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The text escaped for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Permission controls from the shared card, in their rendered order. */
export function permissionAnswers(markup: string) {
  const html = shown(markup)
  const words = (fragment: string): string =>
    decode(fragment.replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim()
  return [
    ...html.matchAll(
      /<button\b([^>]*data-permission-decision="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g,
    ),
  ].map(([, attributes, outcome, body]) => {
    const describedBy = /aria-describedby="([^"]+)"/.exec(attributes!)?.[1]
    const warning =
      describedBy &&
      new RegExp(`<p[^>]*id="${escapeRegExp(describedBy)}"[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1]
    return {
      outcome: outcome!,
      word: words(/<strong[^>]*>([\s\S]*?)<\/strong>/.exec(body!)![1]!),
      says: words(/<small[^>]*>([\s\S]*?)<\/small>/.exec(body!)![1]!),
      warns: warning ? words(warning) : null,
      attributes: attributes!,
    }
  })
}
