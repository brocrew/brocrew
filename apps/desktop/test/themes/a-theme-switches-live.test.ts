import { describe, expect, it } from 'vitest'
import {
  applyTheme,
  THEME_STYLE_ID,
  type ThemeDocument,
} from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor, DEFINED, SAMPLES } from './fixtures'

/** The few parts of a document `applyTheme` touches: a root's attributes, a head, elements by id. */
class FakeElement {
  id = ''
  textContent: string | null = null
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  parent: FakeElement | null = null
  constructor(readonly tagName: string) {}
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  appendChild(child: FakeElement): FakeElement {
    child.parent = this
    this.children.push(child)
    return child
  }
  remove(): void {
    const siblings = this.parent?.children
    if (siblings) siblings.splice(siblings.indexOf(this), 1)
    this.parent = null
  }
}

function fakeDocument() {
  const documentElement = new FakeElement('html')
  const head = documentElement.appendChild(new FakeElement('head'))
  const doc = {
    documentElement,
    head,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
  }
  return { doc: doc as unknown as ThemeDocument, root: documentElement, head }
}

function sample(name: string): Theme {
  const s = SAMPLES[name]!
  const r = validateTheme(s.file, contextFor(s.assets, s.pictures))
  if (!r.ok) throw new Error(JSON.stringify(r.problems))
  return resolveTheme(r.theme, DEFINED)
}

describe('a theme goes on, switches and comes off without a reload', () => {
  it('puts its stylesheet in one style element and names it on the root', () => {
    const { doc, root, head } = fakeDocument()
    expect(applyTheme(sample('win95'), { doc })).toEqual({ ok: true, id: 'win95' })
    expect(head.children.map((c) => c.id)).toEqual([THEME_STYLE_ID])
    expect(head.children[0]!.textContent).toMatch(/^:root\[data-theme='win95'\] \{/)
    expect(root.getAttribute('data-theme')).toBe('win95')
    expect(root.getAttribute('data-controls')).toBe('bevel')
  })

  it('switching replaces the stylesheet and clears the last theme’s attributes', () => {
    const { doc, root, head } = fakeDocument()
    applyTheme(sample('win95'), { doc })
    applyTheme(sample('eink'), { doc })
    expect(head.children).toHaveLength(1)
    expect(head.children[0]!.textContent).toMatch(/^:root\[data-theme='e-ink'\] \{/)
    expect(root.getAttribute('data-theme')).toBe('e-ink')
    expect(root.getAttribute('data-controls')).toBeNull()
    expect(root.getAttribute('data-scrollbar')).toBeNull()
    expect(root.getAttribute('data-pictures')).toBe('grey')
  })

  it('null takes the theme off: the app’s own look comes back', () => {
    const { doc, root, head } = fakeDocument()
    applyTheme(sample('win95'), { doc })
    expect(applyTheme(null, { doc })).toEqual({ ok: true, id: null })
    expect(head.children).toHaveLength(0)
    expect([...root.attributes.keys()]).toEqual([])
  })

  it('a theme that can’t become CSS leaves the one already on in place', () => {
    const { doc, root, head } = fakeDocument()
    applyTheme(sample('zen'), { doc })
    const before = head.children[0]!.textContent
    const broken = { ...sample('kids'), id: 'Not An Id' }
    const r = applyTheme(broken, { doc })
    expect(r).toMatchObject({ ok: false, id: 'zen' })
    expect(head.children[0]!.textContent).toBe(before)
    expect(root.getAttribute('data-theme')).toBe('zen')
  })

  it('files are reached through the URL the caller gives', () => {
    const { doc, head } = fakeDocument()
    applyTheme(sample('valentine'), { doc, assetUrl: (p) => `brobot-theme://valentine/${p}?v=abc` })
    expect(head.children[0]!.textContent).toContain(
      'url("brobot-theme://valentine/assets/hearts.png?v=abc")',
    )
  })
})
