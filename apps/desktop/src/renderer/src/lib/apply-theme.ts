/**
 * Puts a validated theme on the window, or takes it off: one `<style id="brobot-theme">` holds its
 * stylesheet, `data-theme` names it on the root, and its keyword settings become attributes beside
 * it. Calling it again switches live; nothing reloads. If a theme can't be written as CSS, the
 * theme already on stays on.
 */
import { THEME_ATTRIBUTES, themeAttributes, themeCss } from '../../../shared/themes/css'
import type { Theme } from '../../../shared/themes/theme'
import { readableError } from './session-record'

export const THEME_STYLE_ID = 'brobot-theme'

export type AppliedTheme =
  | { readonly ok: true; readonly id: string | null }
  /** Nothing changed: `id` is the theme still on. */
  | { readonly ok: false; readonly id: string | null; readonly error: string }

/** The parts of a document a theme touches. */
export interface ThemeDocument {
  readonly documentElement: {
    getAttribute(name: string): string | null
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  }
  readonly head: { appendChild(node: never): unknown }
  getElementById(id: string): { textContent: string | null; remove(): void } | null
  createElement(tag: 'style'): { id: string; textContent: string | null; remove(): void }
}

export interface ApplyThemeOptions {
  /** The window's own document unless given. */
  readonly doc?: ThemeDocument
  /** How a theme's file becomes a URL; the default is the host's theme scheme. */
  readonly assetUrl?: (path: string) => string
}

/** Applies `theme`, or the app's own look when `theme` is null. */
export function applyTheme(theme: Theme | null, options: ApplyThemeOptions = {}): AppliedTheme {
  const doc = options.doc ?? (globalThis as unknown as { document: ThemeDocument }).document
  const root = doc.documentElement
  const current = root.getAttribute('data-theme')

  let css = ''
  let attributes: Record<string, string> = {}
  if (theme) {
    try {
      css = themeCss(theme, options.assetUrl ? { assetUrl: options.assetUrl } : {})
      attributes = themeAttributes(theme)
    } catch (e) {
      return { ok: false, id: current, error: readableError(e) }
    }
  }

  const existing = doc.getElementById(THEME_STYLE_ID)
  if (!theme) {
    existing?.remove()
  } else if (existing) {
    existing.textContent = css
  } else {
    const style = doc.createElement('style')
    style.id = THEME_STYLE_ID
    style.textContent = css
    doc.head.appendChild(style as never)
  }

  for (const name of THEME_ATTRIBUTES) root.removeAttribute(name)
  if (theme) {
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
    root.setAttribute('data-theme', theme.id)
  } else {
    root.removeAttribute('data-theme')
  }
  return { ok: true, id: theme?.id ?? null }
}
