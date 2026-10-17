/**
 * Check a surface's light paper ground without restating a palette hex value.
 * Require its paint to resolve to the scoped `--chat-bg`, the light scope to redeclare that
 * token differently from `:root`, and the paint to be opaque with luminance at least
 * `PAPER_FLOOR`. Token agreement alone could pass on the dark scope or a near-black palette.
 * The floor separates light from dark; it is a bound, not the current token's luminance.
 */

/**
 * The relative luminance at or above which this app calls a surface paper.
 *
 * ⛔ **Not derived from the current palette, deliberately** — see the note above. Every paper token
 * this app has ever shipped is above 0.94 and every chrome surface is below 0.05, so the gap is two
 * orders of magnitude wide and a bound in the middle of it cannot be tuned by a palette dispatch.
 */
export const PAPER_FLOOR = 0.8

/**
 * `[r, g, b, a]` in 0–255 (alpha 0–1) for the CSS colour forms this app's tokens are written in —
 * `#rgb`, `#rrggbb`, `rgb(…)` and `rgba(…)` — or `null` for anything else, INCLUDING the
 * `transparent` keyword, which is a real answer here rather than a parse failure.
 *
 * ⚠️ **`null` is never treated as "probably fine"** by {@link paperVerdict}: an unparseable ground
 * is reported as unparseable and fails, because the alternative is a check that goes quiet the day
 * a token is written as `color-mix()` or `oklch()`.
 */
export function parseColour(value) {
  const text = String(value ?? '').trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex !== null) {
    const digits = hex[1]
    const wide =
      digits.length === 3
        ? [...digits].map((one) => one + one)
        : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
    return [...wide.map((pair) => Number.parseInt(pair, 16)), 1]
  }
  const rgb = /^rgba?\(([^)]*)\)$/i.exec(text)
  if (rgb === null) return null
  const parts = rgb[1]
    .split(/[\s,/]+/)
    .map((one) => one.trim())
    .filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const channels = parts.slice(0, 3).map((one) => Number.parseFloat(one))
  if (channels.some((one) => !Number.isFinite(one))) return null
  const alpha = parts.length === 4 ? Number.parseFloat(parts[3]) : 1
  if (!Number.isFinite(alpha)) return null
  return [...channels, alpha]
}

/** WCAG relative luminance of an `[r, g, b]`, ignoring alpha — {@link paperVerdict} checks that separately. */
export function luminance([r, g, b]) {
  const channel = (raw) => {
    const one = raw / 255
    return one <= 0.03928 ? one / 12.92 : ((one + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * The page-side expression that reads everything {@link paperVerdict} needs, for one element.
 *
 * ⛔ **The scoped read is taken on the ELEMENT and the control on `documentElement`**, which is the
 * whole of claim 2: `--chat-bg` is `transparent` at `:root` and `var(--paper-bg)` inside
 * `[data-chat-theme='light']`, so reading it from the document would answer for the app and not for
 * the surface.
 *
 * ⚠️ **Splices into an object literal**, so the call sites keep their own extra fields in the one
 * `evaluate` they already make — two round trips could read two different frames.
 *
 * @param {string} element — a JS expression for the element, already in scope page-side.
 */
export function paperFields(element) {
  return (
    `paperBg: getComputedStyle(${element}).backgroundColor, ` +
    `paperScoped: getComputedStyle(${element}).getPropertyValue('--chat-bg').trim(), ` +
    `paperRoot: getComputedStyle(document.documentElement).getPropertyValue('--chat-bg').trim(),`
  )
}

/**
 * Throw unless `read` — the three fields {@link paperFields} produced — describes a surface on
 * paper. Returns a one-line summary for the step's own result line when it holds.
 *
 * @param {{paperBg: string, paperScoped: string, paperRoot: string}} read
 * @param {string} where — named in every failure, because one run checks more than one surface.
 */
export function paperVerdict(read, where) {
  const painted = parseColour(read?.paperBg)
  const scoped = parseColour(read?.paperScoped)
  if (painted === null) {
    throw new Error(`${where}: cannot read a ground colour from ${JSON.stringify(read?.paperBg)}`)
  }
  if (scoped === null) {
    throw new Error(
      `${where}: the surface resolves --chat-bg to ${JSON.stringify(read?.paperScoped)}, which is ` +
        `not a colour this check can compare against`,
    )
  }
  // 2 · the scope redeclared it. Compared as TEXT, because that is the question — the same colour
  // arrived at twice is still one declaration, and this is the claim that the surface is inside a
  // scope of its own rather than wearing the app's.
  if (read.paperScoped === read.paperRoot) {
    throw new Error(
      `${where}: --chat-bg is ${JSON.stringify(read.paperScoped)} on the surface AND at :root — ` +
        `the light scope is not applying, so "on paper" would be the app's own ground`,
    )
  }
  // 1 · the paint IS the token. Channels, not strings: `#f8faff` and `rgb(248, 250, 255)` are one
  // colour written two ways, and only one of the two spellings ever comes back from `getComputedStyle`.
  const same = painted
    .slice(0, 3)
    .every((one, index) => Math.round(one) === Math.round(scoped[index]))
  if (!same) {
    throw new Error(
      `${where}: the surface paints ${read.paperBg} while its own --chat-bg is ${read.paperScoped} — ` +
        `the ground is not coming from the token`,
    )
  }
  // 3 · and it is paper. The claim the hex literal was standing in for, written as a bound.
  if (painted[3] < 1) {
    throw new Error(
      `${where}: the ground is translucent (${read.paperBg}), so what is behind it shows through`,
    )
  }
  const light = luminance(painted)
  if (light < PAPER_FLOOR) {
    throw new Error(
      `${where}: the ground is ${read.paperBg} — luminance ${light.toFixed(3)}, below the ` +
        `${PAPER_FLOOR} this app calls paper`,
    )
  }
  return `on paper: ${read.paperBg} from --chat-bg ${read.paperScoped} (luminance ${light.toFixed(3)}, :root has ${read.paperRoot})`
}

/**
 * The page-side expression that reads an element's resolved `--text` and the one `:root` declares.
 *
 * ⛔ **Both reads in ONE evaluate**, for {@link paperFields}'s reason: two round trips can land in
 * two frames, and the whole question here is whether two elements of the SAME frame resolved the
 * same declaration.
 *
 * @param {string} element — a JS expression for the element, already in scope page-side.
 */
export function inkFields(element) {
  return (
    `ink: getComputedStyle(${element}).getPropertyValue('--text').trim(), ` +
    `rootInk: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),`
  )
}

/**
 * Throw unless this element resolved the ink `:root` declares — i.e. the light scope did NOT reach
 * it — with `sceneInk` as the control that something else DID move.
 *
 * ⛔ **This replaces `if (railText !== '#e7ecf3')`, which `391` made false in the same commit as
 * the ground** (402 §2). `--text` moved to `#e3e8f4` and the resume smoke reported *"the rail was
 * re-themed with the conversation"* about a rail that had not moved at all. ⚠️ **A control that is
 * pinned to a constant is a control that goes off for the wrong reason**, and a chrome check that
 * fires on a palette dispatch is worse than none: it teaches a reader that this row means nothing.
 *
 * ⚑ **`sceneInk` is not optional and there is no default.** Without it, an app that stopped
 * scoping ink ANYWHERE would pass — every element resolving `:root` — which is the failure this
 * row exists to catch, wearing the answer it is checked against.
 *
 * @param {{ink: string, rootInk: string, sceneInk: string}} read
 * @param {string} where — named in every failure.
 */
export function chromeInkVerdict(read, where) {
  if (read?.ink === undefined || read.ink === '') {
    throw new Error(`${where}: nothing resolved --text here`)
  }
  if (read.ink !== read.rootInk) {
    throw new Error(
      `${where}: --text resolves to ${read.ink} where :root declares ${read.rootInk} — a scope ` +
        `reached the chrome`,
    )
  }
  if (read.ink === read.sceneInk) {
    throw new Error(
      `${where}: --text is ${read.ink} on the chrome AND on the surface beside it, so nothing is ` +
        `scoped and this check could not have failed`,
    )
  }
  return `chrome kept :root ink ${read.ink} beside ${read.sceneInk}`
}
