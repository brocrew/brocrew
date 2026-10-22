import MarkdownIt from 'markdown-it'
import { MAX_MESSAGE_PATH_LENGTH } from '../../../shared/runtime-ipc'
import { internalLinkStart } from './message-links'

/**
 * Markdown → HTML. ONE markdown stack for the whole app, in two presets: a document preset for
 * the paper viewer, and a chat preset for what an agent says (017).
 *
 * **`html: false` is the whole security story**, and both presets keep it. With it, markdown-it
 * never passes raw HTML from the source through: `<script>` in a document is escaped and rendered
 * as the text `<script>`, which is what a reader wants to see anyway. That is why there is no
 * sanitizer beside this — not because sanitizing was skipped, but because nothing unsafe is ever
 * produced. (markdown-it also validates link targets itself and drops `javascript:` and
 * `vbscript:` URLs.) It is NOT the whole story for LINKS, though: what a rendered `<a>` does when
 * it is clicked is the main process's guard, not this module's — see the navigation handler in
 * `main/index.ts`, which is what makes a model-authored URL safe to render at all.
 *
 * Slice 2 renders fixtures, so the document input is ours. Slice 3 renders documents an agent
 * wrote, which is exactly when this has to already be right. Chat input is ALREADY the agent's.
 */
const renderer = new MarkdownIt({
  html: false,
  // A bare URL in a document is a link a reader can follow; typographic quotes are noise in text
  // that is often a command or a path.
  linkify: true,
  typographer: false,
})

/**
 * The chat preset. Same library, same `html: false`, two deliberate differences — both because
 * this input is a coding agent talking, not a document someone authored:
 *
 * - **`breaks: true`.** Agents line-break constantly without blank lines: file lists, PASS/FAIL
 *   runs, short status lines. Under markdown's default a single newline is a space, so a reply
 *   that read as three lines WHILE STREAMING (shown verbatim) collapsed into one run-on line the
 *   instant it settled — the text visibly reflowed under the reader. Here a newline is a newline,
 *   which also makes the streamed and settled renderings agree.
 * - **no fuzzy linkification.** linkify-it's fuzzy mode treats any `word.tld` as a URL, and `.md`
 *   (Moldova) and `.sh` (St. Helena) are ccTLDs — so `README.md` and `deploy.sh`, which agents in
 *   this app name in almost every reply, rendered as links to bogus external hosts. With fuzzy off
 *   a link must carry its scheme: `https://example.com` still linkifies, `MEMORY.md` stays text.
 */
const chatRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})
chatRenderer.linkify.set({ fuzzyLink: false, fuzzyEmail: false })

/** Join punctuation escapes before linking bare labels, so file paths keep their meaning. */
chatRenderer.core.ruler.after('text_join', 'work-label-links', (state) => {
  for (const block of state.tokens) {
    if (!block.children) continue
    const children: typeof block.children = []
    let linked = false
    for (const token of block.children) {
      if (token.type === 'link_open') linked = true
      if (token.type !== 'text' || linked) {
        children.push(token)
      } else {
        const labels = /(?<![\w./\\-])W\d+(?:\.\d+)*(?![\w/\\-]|\.[\w/\\])/g
        let start = 0
        for (const hit of token.content.matchAll(labels)) {
          const text = new state.Token('text', '', 0)
          text.content = token.content.slice(start, hit.index)
          children.push(text)
          const open = new state.Token('link_open', 'a', 1)
          open.attrSet('href', hit[0])
          open.meta = { messageLink: true }
          const label = new state.Token('text', '', 0)
          label.content = hit[0]
          children.push(open, label, new state.Token('link_close', 'a', -1))
          start = hit.index + hit[0].length
        }
        const tail = new state.Token('text', '', 0)
        tail.content = token.content.slice(start)
        children.push(tail)
      }
      if (token.type === 'link_close') linked = false
    }
    block.children = children
  }
})

/**
 * ⚠️ **Model-authored markdown may not reach the asset scheme** (067, from its review).
 *
 * `brobot-asset:` is served by the main process for any absolute path to an existing image file,
 * wherever it is (`726` · R92: no root), so an `![](brobot-asset://file/…)` written by the model
 * would render an `<img>` of ANY image on disk — any session's, not just this conversation's. The
 * door checks the file's type; it does not, and should not, know which session is on screen.
 *
 * markdown-it's own `validateLink` blocks `javascript:`, `vbscript:`, `file:` and non-image `data:`
 * and lets every other scheme through, so this scheme has to be named. **Our own components set
 * `src` directly** — `ImageEntry`/`ImageViewer` build it from a path the runtime resolved — so
 * nothing legitimate loses anything by this.
 *
 * Both presets, not just chat: a document preview renders agent-authored documents from Slice 3 on.
 */
const forbidden = /^brobot-asset:/i
for (const md of [renderer, chatRenderer]) {
  const base = md.validateLink.bind(md)
  md.validateLink = (url: string): boolean => !forbidden.test(url.trim()) && base(url)
}

/** Windows destinations keep separators that CommonMark would treat as punctuation escapes. */
const A_WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\)/
export const LOCAL_LINK_ATTRIBUTE = 'data-local-path'
export const LOCAL_LINK_START = '<!--local-file:'
export const LOCAL_LINK_END = '<!--/local-file:'
export const LOCAL_LABEL_END = '<!--/local-file-label:'

/** Explicit destinations need no prose heuristic; main still decides what they resolve to. */
export function isLocalLinkPath(path: string): boolean {
  return (
    path !== '' &&
    path.length <= MAX_MESSAGE_PATH_LENGTH &&
    !path.includes('\0') &&
    !path.startsWith('#') &&
    !path.startsWith('//') &&
    !path.startsWith('\\\\') &&
    (/^[A-Za-z]:[\\/]/.test(path) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path))
  )
}

/** A Windows share (`\\server\share\…`): drawn like a local path, but never opened. */
export function isNetworkPath(path: string): boolean {
  return path.startsWith('\\\\') && path.length <= MAX_MESSAGE_PATH_LENGTH && !path.includes('\0')
}

function localLinkKey(path: string): string | null {
  try {
    return encodeURIComponent(path)
  } catch {
    return null
  }
}

for (const md of [renderer, chatRenderer]) {
  const parse = md.helpers.parseLinkDestination
  md.helpers.parseLinkDestination = (str, start, max) => {
    const result = parse(str, start, max)
    if (!result.ok) return result
    const angled = str.charCodeAt(start) === 0x3c
    const raw = str.slice(angled ? start + 1 : start, angled ? result.pos - 1 : result.pos)
    return A_WINDOWS_PATH.test(raw) ? { ...result, str: raw } : result
  }
  // HTML attribute escaping is enough for paths; URL encoding would lose literal percent names.
  const normalize = md.normalizeLink
  md.normalizeLink = (url) =>
    isLocalLinkPath(url) || A_WINDOWS_PATH.test(url) ? url : normalize(url)

  md.core.ruler.after('linkify', 'local-file-links', (state) => {
    for (const block of state.tokens) {
      const links: Array<string | null> = []
      for (const token of block.children ?? []) {
        if (token.type === 'link_open') {
          const path = token.attrGet('href')?.trim() ?? ''
          const key = isLocalLinkPath(path) || isNetworkPath(path) ? localLinkKey(path) : null
          links.push(key)
          if (key !== null) {
            token.attrSet(LOCAL_LINK_ATTRIBUTE, path)
            token.meta = { ...token.meta, localFileKey: key }
          }
        } else if (token.type === 'link_close') {
          const key = links.pop()
          if (key != null) token.meta = { ...token.meta, localFileKey: key }
        } else if (token.type === 'image' && links.some((key) => key !== null)) {
          token.meta = { ...token.meta, localFileLabel: true }
        }
      }
    }
  })
  md.core.ruler.after('linkify', 'internal-link-labels', (state) => {
    for (const block of state.tokens) {
      let internal = false
      for (const token of block.children ?? []) {
        if (token.type === 'link_open') internal = /^brocrew:/i.test(token.attrGet('href') ?? '')
        else if (token.type === 'link_close') internal = false
        else if (token.type === 'image' && internal)
          token.meta = { ...token.meta, internalLinkLabel: true }
      }
    }
  })
}

/**
 * The only image destination that may become an `<img>`: an inline one (071, from 069 finding 2).
 *
 * markdown-it's own `validateLink` already refuses `data:` that is not an image and refuses
 * `data:image/svg+xml` with it, so what this admits cannot carry script — and, the point here, it
 * cannot carry a request either. Everything about a `data:` URL is already in the document.
 */
const INLINE_IMAGE = /^data:image\//i

/**
 * ⚠️ **A remote image in a reply is an outbound request nobody approved** (071, from 069 finding 2).
 *
 * `html: false` does not disable `![…](…)`: markdown-it's image rule emits an `<img src>` and its
 * `validateLink` explicitly permits `https:`. The browser fetches it on render — no tool call, no
 * card, no click, and no record in the transcript that a request happened — which routes around the
 * one gate this app builds its permission UI on, since `WebFetch`/`WebSearch` are outside the exempt
 * list precisely so egress prompts. Chained with an unapproved `Read` it was a complete credential
 * theft (069 A1), and it re-fires every time an archived conversation is replayed.
 *
 * **A destination rule, not a scheme rule** — the correction 050 made for navigation and 069 A2 asks
 * for again here. Both this module's `^brobot-asset:` refusal and markdown-it's own `BAD_PROTO_RE`
 * test the SCHEME, so a destination carrying none walks past both: in a packaged build the document
 * is `file:///…/index.html`, so `![](../../provider-homes/…/x.png)` resolves on the filesystem and
 * renders another session's picture as this conversation's. Naming what is ALLOWED is what makes
 * that a non-question.
 *
 * **What a refused image becomes: a link, showing its own destination as its text.** Not silence —
 * the model wrote something and the reader should see that it did — and not the alt text alone,
 * which is the model's word for where a URL goes (069 finding 8's concern, in the one place here
 * that can answer it cheaply). Clicking it is already safe: the navigation guard refuses to navigate
 * the app anywhere and hands http/https to the real browser instead.
 *
 * Nothing legitimate is lost. Our own components — `ImageEntry`, `ImageViewer` — set `src` directly
 * from a path the runtime resolved and never go through markdown at all.
 */
for (const md of [renderer, chatRenderer]) {
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index]
    if (!token) return ''
    const source = token.attrGet('src')?.trim() ?? ''
    if (INLINE_IMAGE.test(source)) {
      // The default rule's own first line, kept: the alt ATTRIBUTE is filled from the alt SOURCE,
      // which markdown-it parses into children rather than into the attribute.
      token.attrSet('alt', self.renderInlineAsText(token.children ?? [], options, env))
      return self.renderToken(tokens, index, options)
    }
    const escaped = md.utils.escapeHtml(source)
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    const label = alt === '' ? escaped : `${md.utils.escapeHtml(alt)} — ${escaped}`
    // `validateLink` decides the `href` exactly as it would for an ordinary link, so a destination
    // this app refuses to navigate to is not made clickable by having arrived as an image.
    if (/^brocrew:/i.test(source) && token.meta?.internalLinkLabel !== true)
      return `${internalLinkStart(source, md.utils.escapeHtml)}${label}</button>`
    return md.validateLink(source) &&
      token.meta?.localFileLabel !== true &&
      token.meta?.internalLinkLabel !== true
      ? `<a href="${escaped}" class="refused-image">${label}</a>`
      : `<span class="refused-image">${label}</span>`
  }
}

/**
 * Does this text CLAIM a destination of its own? The host it claims, or null.
 *
 * Only a link whose visible text names somewhere can disagree with where it goes. `[the diff on
 * GitHub](…)` claims nothing checkable — it is prose, and marking it would be this project's own
 * mistake in reverse: an assertion of "mismatch" where nothing was compared.
 *
 * ⚠️ **The text must be URL-SHAPED, not merely dotted, and that costs a real case.** A dotted token
 * on its own cannot be told from a filename, because the collision is genuine and this module
 * already documents it one screen up: `.md` is Moldova and `.sh` is St. Helena. `README.md` and
 * `deploy.sh` are in almost every reply an agent writes here, and a rule that read them as host
 * claims would put a "goes somewhere else" marker on ordinary output constantly — which does not
 * make the app more honest, it makes the one marker that matters unreadable. `fuzzyLink:false`
 * exists for exactly this reason and is the precedent.
 *
 * So a claim needs something a filename does not have: a scheme, a `www.`, or a path/query/fragment
 * after the host. The realistic impersonation carries one — `github.com/anthropics/x`,
 * `docs.stripe.com/api` — because the point is to look like the page it is imitating.
 *
 * **The deliberate gap:** a bare `[github.com](https://attacker.example)` is NOT flagged. Its
 * destination is still disclosed in `title`, like every link. Closing it would need a TLD list, and
 * a TLD list is the thing that made `README.md` a link to Moldova in the first place.
 */
function claimedHost(text: string): string | null {
  const trimmed = text.trim()
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const urlShaped =
    scheme ||
    /^www\.[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+[/?#]/i.test(trimmed)
  if (!urlShaped) return null
  try {
    return new URL(scheme ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Where the link actually goes, as a host — or null when it names none (a relative destination). */
function targetHost(href: string): string | null {
  try {
    return new URL(href.trim()).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Enough of a destination to judge it, without letting one URL take over the line. */
function clip(value: string): string {
  return value.length > 64 ? `${value.slice(0, 63)}…` : value
}

/**
 * ⚠️ **A link's visible text and its real target are never compared or disclosed** (074, from 069
 * finding 8) — the one remaining way a reply can state something untrue with no scheme involved.
 *
 * `[the diff on GitHub](https://attacker.example/…)` renders with only the text showing. The main
 * process is doing its job on the click — it refuses to navigate this window anywhere and hands
 * http/https to the real browser — but by then the reader has already decided, and nothing between
 * the two ever showed them what they were deciding about.
 *
 * **Two things, because "disclose" and "compare" are different promises:**
 *  - Every link gets its resolved destination in `title`, which is this codebase's disclosure
 *    convention already (timestamps, paths, the permission card's own hover text). Available on
 *    demand, costs the reading nothing.
 *  - A link whose TEXT claims a host that is not the one it goes to gets that stated INLINE, in the
 *    same `text — destination` shape 071 gave a refused image. Hover is not enough for this one: the
 *    disagreement is the finding, and a disclosure a reader has to already be suspicious enough to
 *    go looking for does not disclose anything.
 *
 * Prose text is left alone on purpose. `[the diff on GitHub](…)` names no host, so there is nothing
 * to disagree with it — and marking it anyway would be this project's own mistake in reverse: an
 * assertion of "mismatch" where nothing was ever compared.
 *
 * The span sits OUTSIDE the anchor, so what it says is the app speaking and not more link text.
 */
for (const md of [renderer, chatRenderer]) {
  md.renderer.rules.link_close = (tokens, index, options, env, self) => {
    const closed = self.renderToken(tokens, index, options)
    const localKey = tokens[index]?.meta?.localFileKey
    const finish = (disclosure: string): string =>
      typeof localKey === 'string'
        ? `${closed}${LOCAL_LABEL_END}${localKey}-->${disclosure}${LOCAL_LINK_END}${localKey}-->`
        : closed + disclosure
    // Backward to this link's own opening token. Markdown cannot nest links, so the nearest one is
    // always the match — and a `link_close` with no `link_open` before it is not a thing markdown-it
    // can produce, so the null case is a guard rather than a branch anyone reaches.
    let open = index - 1
    while (open >= 0 && tokens[open]?.type !== 'link_open') open -= 1
    // A local link has lost its `href` by now; its destination is still on `data-local-path`.
    const destination = tokens[open]?.attrGet('href') ?? tokens[open]?.attrGet(LOCAL_LINK_ATTRIBUTE)
    const href = open >= 0 ? (destination?.trim() ?? '') : ''
    if (/^brocrew:/i.test(href) || tokens[open]?.meta?.messageLink === true) return '</button>'
    if (href === '') return finish('')
    // ⚠️ **An image's alt is the visible text of a link that wraps one**, and `content` is its raw
    // SOURCE rather than what a reader sees.
    //
    // A review finding claimed `image.content` is empty and the alt lives only in `children`. That
    // is false on the pinned markdown-it — measured: parsing
    // `[![github.com/anthropics/x](badge.png)](…)` yields an image token whose `content` is exactly
    // `github.com/anthropics/x`. Recorded because a fix resting on a wrong reason is the thing this
    // whole task is about.
    //
    // The real difference is markup INSIDE the alt: for `![**github.com**/x](p)` the raw source
    // carries the asterisks and the reader does not, so a comparison against `content` is comparing
    // against something nobody sees. `renderInlineAsText` is the API the image rule beside this one
    // already uses, for the same reason.
    const text = tokens
      .slice(open + 1, index)
      .map((token) =>
        token.type === 'image'
          ? self.renderInlineAsText(token.children ?? [], options, env)
          : token.content,
      )
      .join('')
    const claimed = claimedHost(text)
    if (claimed === null || claimed === targetHost(href)) return finish('')
    return finish(`<span class="link-target"> → ${md.utils.escapeHtml(clip(href))}</span>`)
  }

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const href = token?.attrGet('href')?.trim() ?? ''
    if (/^brocrew:/i.test(href) || token?.meta?.messageLink === true) {
      return internalLinkStart(href, md.utils.escapeHtml)
    }
    // Never over an author's own `[text](url "title")` — that title is something a human wrote about
    // the link, and replacing it with the URL would drop information to add none.
    if (token && href !== '' && token.attrGet('title') === null) token.attrSet('title', href)
    const localKey = token?.meta?.localFileKey
    // A local path is never a link: the window draws its own Copy and Open beside it.
    if (token && (href.startsWith('\\\\') || typeof localKey === 'string')) {
      if (href.startsWith('\\\\')) token.attrSet('title', href)
      token.attrs?.splice(token.attrIndex('href'), 1)
    }
    const opened = self.renderToken(tokens, index, options)
    return typeof localKey === 'string' ? `${LOCAL_LINK_START}${localKey}-->${opened}` : opened
  }
}

/** A document, on paper — the drawer and every preview. */
export function renderMarkdown(source: string): string {
  return renderer.render(source)
}

/** What an agent said, in the conversation stream. */
export function renderChatMarkdown(source: string): string {
  return chatRenderer.render(source)
}

/** One short plain preview, parsed by the same markdown library as the full words. */
export function plainChatPreview(source: string): string {
  const words: string[] = []
  const walk = (tokens: ReturnType<typeof chatRenderer.parse>): void => {
    for (const token of tokens) {
      if (token.children) walk(token.children)
      else if (
        token.type === 'text' ||
        token.type === 'code_inline' ||
        token.type === 'fence' ||
        token.type === 'code_block'
      )
        words.push(token.content)
      else if (token.type === 'softbreak' || token.type === 'hardbreak' || token.block)
        words.push(' ')
    }
  }
  walk(chatRenderer.parse(source.slice(0, 2048), {}))
  return words.join('').replace(/\s+/g, ' ').trim().slice(0, 160)
}
