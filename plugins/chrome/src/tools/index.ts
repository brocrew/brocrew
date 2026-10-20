import { privateFolder } from '../privatePaths.js'
import { PublicToolError } from '../shared/toolServer.js'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import type { BrowserContext, Download } from 'playwright-core'
import type { ToolHandler, ToolResult } from '../shared/toolServer.js'
import { openGuardedFile } from '../localFileGuard.js'
import {
  MAX_DOWNLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  dayFolder,
  mimeFor,
  reserveFile,
  sanitizeDownloadName,
} from '../files.js'
import { MAX_TEXT, ToolError, jsonSchemaOf, parseArgs } from './schema.js'
import {
  DEFAULT_NETWORK_LIMIT,
  DEFAULT_TIMEOUT_MS,
  KEY,
  MAX_SCREENSHOT_BYTES,
  MAX_TIMEOUT_MS,
  checkUrl,
  describeError,
  generationOf,
  jsonValue,
  locate,
  onTab,
  profileName,
  raceTimeout,
  ref,
  since,
  moreMarker,
  networkLimit,
  networkType,
  pageMaxChars,
  pageOffset,
  pageText,
  tabId,
  timeoutMs,
  timeoutOf,
  titleAfterLoad,
  titleOf,
  url,
  urlIncludes,
  usableProfile,
  withNotes,
} from './common.js'
import type { ToolDef, ToolDeps } from './common.js'
import { buildProfileToolDefs } from './profileTools.js'
import { buildShowHideDefs } from './showHide.js'
import { MAX_REOPEN, TITLE_RESERVE_MS, nowMs, reopenTabs } from './modeSwitch.js'
import { PENDING_DOWNLOAD_MS } from '../tabs.js'
import type { TabState } from '../tabs.js'
import { DESCRIPTION_MAX, ProfileStoreError } from '../profiles/store.js'
export {
  DEFAULT_TIMEOUT_MS,
  MAX_SCREENSHOT_BYTES,
  checkUrl,
  describeError,
  jsonValue,
} from './common.js'
export type { ToolDeps, ToolOutput } from './common.js'
export function buildToolDefs(): ToolDef[] {
  return [
    {
      spec: {
        name: 'list_browser_profiles',
        description:
          'List the Chrome profiles: name, description, whether the user enabled it, temporary or not, open or closed, mode (headless/visible). Only enabled profiles can be used.',
        props: {},
      },
      async run(_a, deps) {
        return {
          json: deps.store.list().map((p) => {
            const s = deps.browser.state(p.name)
            return {
              name: p.name,
              description: p.description,
              temporary: p.temporary,
              enabled: p.enabled,
              allowExtensions: p.allowExtensions,
              allowSettings: p.allowSettings,
              open: s !== null,
              mode: s?.mode ?? null,
            }
          }),
        }
      },
    },
    {
      spec: {
        name: 'create_browser_profile',
        description:
          'Create a new empty Chrome profile (one per account). It starts DISABLED: the user enables it in the Settings → Plugins → Chrome. temporary:true instead makes a throwaway profile that is enabled at once, never signed in and without extensions or settings access; it is deleted after 10 minutes idle, when the server restarts, or by delete_browser_profile. name is optional for a temporary profile (tmp-xxxxxx).',
        props: {
          name: profileName,
          description: {
            type: 'string',
            description: `What the profile is for (plain text, at most ${DESCRIPTION_MAX} characters).`,
            maxLength: DESCRIPTION_MAX,
          },
          temporary: {
            type: 'boolean',
            description: 'true: a throwaway profile, enabled at once, deleted when idle.',
          },
        },
      },
      async run(a, deps) {
        const temporary = a.temporary === true
        if (a.name === undefined && !temporary)
          throw new ToolError('name is required (only a temporary profile gets a generated name)')
        if (deps.store.list().length >= MAX_PROFILES)
          throw new ToolError(
            `there are already ${MAX_PROFILES} profiles — ask the user to delete one in the Settings → Plugins → Chrome`,
          )
        const name = (a.name as string | undefined) ?? `tmp-${randomBytes(3).toString('hex')}`
        try {
          deps.logger?.info('admin action', {
            action: 'create',
            profile: name,
            actor: 'agent-tool',
            temporary,
          })
          const rec = deps.store.create(name, 'agent', {
            temporary,
            ...(a.description !== undefined ? { description: a.description as string } : {}),
          })
          return {
            json: {
              name: rec.name,
              enabled: rec.enabled,
              temporary: rec.temporary,
              description: rec.description,
              note: temporary
                ? 'created enabled and temporary: it is deleted after 10 minutes idle, on a server restart, or by delete_browser_profile'
                : 'created disabled; the user enables it in the Settings → Plugins → Chrome (signing in is optional)',
            },
          }
        } catch (e) {
          if (e instanceof ProfileStoreError && /description/.test(e.message))
            throw new ToolError(e.message)
          throw new ToolError(
            e instanceof Error && /already exists/.test(e.message)
              ? `profile "${name}" already exists`
              : 'the profile could not be created',
          )
        }
      },
    },
    {
      spec: {
        name: 'set_browser_profile_description',
        description: `Set the description of any profile (enabled or not): a plain-text label of what the profile is for, at most ${DESCRIPTION_MAX} characters, shown in list_browser_profiles and the Plugins screen. An empty string clears it.`,
        props: {
          profile: profileName,
          description: {
            type: 'string',
            description: 'The new description.',
            maxLength: DESCRIPTION_MAX,
          },
        },
        required: ['profile', 'description'],
      },
      async run(a, deps) {
        const name = a.profile as string
        if (!deps.store.get(name)) throw new ToolError(`profile "${name}" does not exist`)
        try {
          deps.logger?.info('admin action', {
            action: 'description',
            profile: name,
            actor: 'agent-tool',
          })
          const rec = deps.store.setDescription(name, a.description as string)
          return { json: { name: rec.name, description: rec.description } }
        } catch (e) {
          throw new ToolError(
            e instanceof ProfileStoreError && /description/.test(e.message)
              ? e.message
              : 'the description could not be saved',
          )
        }
      },
    },
    {
      spec: {
        name: 'delete_browser_profile',
        description:
          'Delete a TEMPORARY profile (created with create_browser_profile temporary:true): closes its Chrome and removes its files. Normal profiles cannot be deleted by agents; the user deletes those in the Settings → Plugins → Chrome.',
        props: { profile: profileName },
        required: ['profile'],
      },
      async run(a, deps) {
        const name = a.profile as string
        const rec = deps.store.get(name)
        if (!rec) throw new ToolError(`profile "${name}" does not exist`)
        if (!rec.temporary)
          throw new ToolError(
            `profile "${name}" is not temporary — only the user can delete it, in the Settings → Plugins → Chrome`,
          )
        deps.logger?.info('admin action', {
          action: 'delete',
          profile: name,
          actor: 'agent-tool',
          temporary: true,
        })
        await deps.browser.exclusive(name, async () => {
          await deps.browser.close(name)
          deps.store.remove(name)
        })
        return { json: { deleted: name } }
      },
    },
    {
      spec: {
        name: 'open_tab',
        description:
          'Open a new tab in an enabled profile (headless unless visible:true) and load a URL. Returns the tabId used by every other tool. visible:true restarts the profile in a visible window, which invalidates its other tab ids; newWindow only has an effect when visible.',
        props: {
          profile: profileName,
          url,
          newWindow: {
            type: 'boolean',
            description: 'Open in a new window (visible profiles only; no effect headless).',
          },
          visible: {
            type: 'boolean',
            description:
              'true: show Chrome in a window; false: go back to headless; omitted: keep the current mode. A change restarts the profile and reopens its open tabs at their URLs under the same tab ids (form state is lost).',
          },
        },
        required: ['profile', 'url'],
      },
      async run(a, deps) {
        const name = a.profile as string
        const target = checkUrl(a.url as string)
        usableProfile(deps, name)
        const startedAt = nowMs(deps)
        deps.tabs.watch(name, deps.browser)
        deps.browser.touch(name)
        const out = await deps.browser.exclusive(name, async () => {
          usableProfile(deps, name)
          const mode =
            a.visible === true
              ? 'visible'
              : a.visible === false
                ? 'headless'
                : (deps.browser.state(name)?.mode ?? 'headless')
          const before = deps.browser.state(name)
          const reopen =
            before !== null && before.mode !== mode
              ? deps.tabs
                  .list(generationOf(deps), name)
                  .slice(0, MAX_REOPEN)
                  .map((t) => ({ id: t.id, url: t.page.url() }))
              : []
          const { generation } = await deps.browser.ensure(name, mode)
          usableProfile(deps, name)
          const restored = await reopenTabs(
            deps,
            name,
            generation,
            reopen,
            startedAt + MAX_TIMEOUT_MS - DEFAULT_TIMEOUT_MS - TITLE_RESERVE_MS,
          )
          const page = await deps.browser.newPage(name, {
            newWindow: a.newWindow === true && mode === 'visible',
          })
          const tab = deps.tabs.add(name, generation, page)
          let loadError: string | undefined
          try {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS })
          } catch (e) {
            loadError = describeError(e, DEFAULT_TIMEOUT_MS)
          }
          const skipped = restored.filter((t) => t.note !== undefined).length
          return {
            tabId: tab.id,
            url: page.url(),
            title: await titleAfterLoad(page),
            ...(loadError ? { loadError } : {}),
            ...(restored.length ? { restoredTabs: restored } : {}),
            ...(skipped
              ? {
                  note: `the restart took long: ${skipped} of the ${restored.length} earlier tab(s) could not be reopened in time (their ids stay dead)`,
                }
              : {}),
          }
        })
        deps.browser.touch(name)
        return { json: out }
      },
    },
    {
      spec: {
        name: 'list_tabs',
        description:
          'List open tabs (id, profile, url, title) of enabled profiles, or of one profile.',
        props: { profile: profileName },
      },
      async run(a, deps) {
        if (a.profile !== undefined) usableProfile(deps, a.profile as string)
        let tabs = deps.tabs.list(generationOf(deps), a.profile as string | undefined)
        if (a.profile === undefined)
          tabs = tabs.filter((t) => deps.store.get(t.profile)?.enabled === true)
        return {
          json: await Promise.all(
            tabs.map(async (t) => ({
              tabId: t.id,
              profile: t.profile,
              url: t.page.url(),
              title: await titleOf(t.page),
            })),
          ),
        }
      },
    },
    {
      spec: {
        name: 'close_tab',
        description: 'Close a tab.',
        props: { tabId },
        required: ['tabId'],
      },
      async run(a, deps) {
        const { notes } = await onTab(deps, a.tabId as string, async ({ page }) => {
          await page.close()
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'navigate',
        description:
          'Go to a URL, or back / forward / reload (exactly one of url and action). Refs of the tab become invalid; call snapshot again.',
        props: {
          tabId,
          url,
          action: {
            type: 'string',
            description: 'back, forward or reload.',
            enum: ['back', 'forward', 'reload'],
          },
          timeoutMs,
        },
        required: ['tabId'],
      },
      async run(a, deps) {
        if ((a.url === undefined) === (a.action === undefined))
          throw new ToolError('give exactly one of url and action')
        const target = a.url === undefined ? undefined : checkUrl(a.url as string)
        const ms = timeoutOf(a)
        const { value, notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const opts = { waitUntil: 'domcontentloaded' as const, timeout: ms }
          const history = { waitUntil: 'commit' as const, timeout: ms }
          tab.refs = null
          const res =
            target !== undefined
              ? await page.goto(target, opts)
              : a.action === 'back'
                ? await page.goBack(history)
                : a.action === 'forward'
                  ? await page.goForward(history)
                  : await page.reload(opts)
          return {
            url: page.url(),
            title: await titleAfterLoad(page),
            status: res ? res.status() : null,
          }
        })
        return withNotes(value, notes)
      },
    },
    {
      spec: {
        name: 'snapshot',
        description:
          'Read the page. mode "aria" (default): an accessibility tree whose interactive elements carry refs like [ref=e12]; use those refs in click, fill, etc. Refs are valid until the next snapshot or navigation. mode "text": the visible page text (falls back to the aria tree if the page is too heavy to read in time). At most maxChars (default 100000) per call; a long page ends with a "[more: ... offset=N]" marker, call again with that offset to read on.',
        props: {
          tabId,
          mode: { type: 'string', description: 'aria (default) or text.', enum: ['aria', 'text'] },
          offset: pageOffset,
          maxChars: pageMaxChars,
          timeoutMs,
        },
        required: ['tabId'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const offset = (a.offset as number | undefined) ?? 0
        const max = (a.maxChars as number | undefined) ?? MAX_TEXT
        const { value, notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const head = async (extra = ''): Promise<string> =>
            `url: ${page.url()}\ntitle: ${await titleOf(page)}\n${offset ? `offset: ${offset}\n` : ''}${extra}\n`
          const aria = async (
            timeout: number,
          ): Promise<{
            body: string
            next: number | null
          }> => {
            const full = await page.ariaSnapshot({ mode: 'ai', timeout })
            tab.refs = new Set([...full.matchAll(/\[ref=([A-Za-z0-9]+)\]/g)].map((m) => m[1]))
            return pageText(full, offset, max)
          }
          if (a.mode === 'text') {
            let got: string | undefined
            try {
              got = String(
                await raceTimeout(
                  page.evaluate(
                    (r: { from: number; to: number }) =>
                      (document.body?.innerText ?? '').slice(r.from, r.to),
                    { from: offset, to: offset + max + 1 },
                  ),
                  Math.ceil(ms / 2),
                ),
              )
            } catch {
              const f = await aria(Math.floor(ms / 2))
              return {
                header: await head(
                  '[text mode timed out on this page; showing the aria tree instead]\n',
                ),
                body: f.body + moreMarker('snapshot', f.next),
              }
            }
            const more = got.length > max
            return {
              header: await head(),
              body: got.slice(0, max) + moreMarker('snapshot', more ? offset + max : null),
            }
          }
          const f = await aria(ms)
          return { header: await head(), body: f.body + moreMarker('snapshot', f.next) }
        })
        return {
          text: value.header + value.body + (notes.length ? `\n\nnotes: ${notes.join('; ')}` : ''),
        }
      },
    },
    {
      spec: {
        name: 'click',
        description: 'Click an element by ref.',
        props: {
          tabId,
          ref,
          button: {
            type: 'string',
            description: 'left (default), right or middle.',
            enum: ['left', 'right', 'middle'],
          },
          double: { type: 'boolean', description: 'Double-click.' },
          timeoutMs,
        },
        required: ['tabId', 'ref'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const loc = locate(tab, page, a.ref as string)
          const opts = {
            button: (a.button as 'left' | 'right' | 'middle' | undefined) ?? 'left',
            timeout: ms,
          }
          if (a.double === true) await loc.dblclick(opts)
          else await loc.click(opts)
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'fill',
        description:
          'Replace the value of an input or textarea by ref; submit:true presses Enter afterwards.',
        props: {
          tabId,
          ref,
          text: { type: 'string', description: 'The new value.', maxLength: MAX_TEXT },
          submit: { type: 'boolean', description: 'Press Enter after filling.' },
          timeoutMs,
        },
        required: ['tabId', 'ref', 'text'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const loc = locate(tab, page, a.ref as string)
          await loc.fill(a.text as string, { timeout: ms })
          if (a.submit === true) await loc.press('Enter', { timeout: ms })
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'type',
        description:
          'Type text key by key into an element by ref (for fields that react to key events). Use fill for plain values.',
        props: {
          tabId,
          ref,
          text: { type: 'string', description: 'Text to type.', maxLength: 10000 },
          delayMs: {
            type: 'number',
            description: 'Pause between keys in ms (default 0, max 1000).',
            integer: true,
            min: 0,
            max: 1000,
          },
          timeoutMs,
        },
        required: ['tabId', 'ref', 'text'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          await locate(tab, page, a.ref as string).pressSequentially(a.text as string, {
            delay: (a.delayMs as number | undefined) ?? 0,
            timeout: ms,
          })
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'press_key',
        description:
          'Press a key or chord ("Enter", "Control+A", "ArrowDown"), on an element by ref or on the page.',
        props: {
          tabId,
          key: { type: 'string', description: 'Key name or chord.', pattern: KEY },
          ref,
          timeoutMs,
        },
        required: ['tabId', 'key'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          if (a.ref !== undefined)
            await locate(tab, page, a.ref as string).press(a.key as string, { timeout: ms })
          else await page.keyboard.press(a.key as string)
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'select',
        description:
          'Choose option(s) of a <select> by value or label. Returns the selected values.',
        props: {
          tabId,
          ref,
          values: {
            type: 'array',
            description: 'Option values or labels.',
            maxItems: 50,
            minItems: 1,
            itemMaxLength: 500,
          },
          timeoutMs,
        },
        required: ['tabId', 'ref', 'values'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { value, notes } = await onTab(deps, a.tabId as string, ({ tab, page }) =>
          locate(tab, page, a.ref as string).selectOption(a.values as string[], { timeout: ms }),
        )
        return withNotes({ selected: value }, notes)
      },
    },
    {
      spec: {
        name: 'hover',
        description: 'Move the pointer over an element by ref.',
        props: { tabId, ref, timeoutMs },
        required: ['tabId', 'ref'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, ({ tab, page }) =>
          locate(tab, page, a.ref as string).hover({ timeout: ms }),
        )
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'scroll',
        description:
          'Scroll an element into view (ref) and/or scroll the page by dy pixels (positive = down).',
        props: {
          tabId,
          ref,
          dy: {
            type: 'number',
            description: 'Pixels to scroll vertically.',
            min: -20000,
            max: 20000,
          },
          timeoutMs,
        },
        required: ['tabId'],
      },
      async run(a, deps) {
        if (a.ref === undefined && a.dy === undefined) throw new ToolError('give ref, dy or both')
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          if (a.ref !== undefined)
            await locate(tab, page, a.ref as string).scrollIntoViewIfNeeded({ timeout: ms })
          if (a.dy !== undefined) await page.mouse.wheel(0, a.dy as number)
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'screenshot',
        description: 'PNG screenshot of the viewport, the full page, or one element (ref).',
        props: {
          tabId,
          scope: {
            type: 'string',
            description: 'viewport, full or element.',
            enum: ['viewport', 'full', 'element'],
          },
          ref,
          timeoutMs,
        },
        required: ['tabId', 'scope'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        if ((a.scope === 'element') !== (a.ref !== undefined))
          throw new ToolError('scope "element" needs ref, and the other scopes take none')
        const { value } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const png =
            a.scope === 'element'
              ? await locate(tab, page, a.ref as string).screenshot({ timeout: ms })
              : await page.screenshot({ fullPage: a.scope === 'full', timeout: ms })
          if (png.length > MAX_SCREENSHOT_BYTES)
            throw new ToolError('the screenshot is too large — use scope viewport or element')
          return png
        })
        return { image: value, caption: `${a.scope as string} screenshot of ${a.tabId as string}` }
      },
    },
    {
      spec: {
        name: 'evaluate',
        description:
          'Evaluate a JavaScript expression in the page and return its JSON result (capped at 100 KB). Reads what the signed-in page shows; same trust level as the other Chrome tools.',
        props: {
          tabId,
          expression: {
            type: 'string',
            description:
              'A JavaScript expression, or a function expression such as "(x) => x * 2" to be called with arg.',
            minLength: 1,
            maxLength: 20000,
          },
          arg: {
            type: 'scalar',
            description:
              'Optional argument (text, number or boolean) passed to a function expression.',
          },
          timeoutMs,
        },
        required: ['tabId', 'expression'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { value, notes } = await onTab(deps, a.tabId as string, async ({ page }) =>
          jsonValue(
            await raceTimeout(
              page.evaluate(
                a.arg === undefined
                  ? (a.expression as string)
                  : `(${a.expression as string})(${JSON.stringify(a.arg)})`,
              ),
              ms,
            ),
          ),
        )
        return { text: value + (notes.length ? `\nnotes: ${notes.join('; ')}` : '') }
      },
    },
    {
      spec: {
        name: 'wait_for',
        description:
          'Wait until text appears/disappears, an element (ref) is visible/hidden, the URL contains a string, and/or the page reaches a load state. At least one condition.',
        props: {
          tabId,
          text: { type: 'string', description: 'Text to wait for.', minLength: 1, maxLength: 500 },
          ref,
          state: {
            type: 'string',
            description: 'visible (default) or hidden, for text and ref.',
            enum: ['visible', 'hidden'],
          },
          urlIncludes: {
            type: 'string',
            description: 'Wait until the page URL contains this.',
            minLength: 1,
            maxLength: 500,
          },
          loadState: {
            type: 'string',
            description:
              'Wait until the page reaches this load state (page-ready): domcontentloaded, load or networkidle.',
            enum: ['domcontentloaded', 'load', 'networkidle'],
          },
          timeoutMs,
        },
        required: ['tabId'],
      },
      async run(a, deps) {
        if (
          a.text === undefined &&
          a.ref === undefined &&
          a.urlIncludes === undefined &&
          a.loadState === undefined
        )
          throw new ToolError('give text, ref, urlIncludes or loadState')
        const total = timeoutOf(a)
        const state = (a.state as 'visible' | 'hidden' | undefined) ?? 'visible'
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const deadline = Date.now() + total
          const left = (): number => Math.max(1, deadline - Date.now())
          if (a.urlIncludes !== undefined)
            await page.waitForURL((u) => u.href.includes(a.urlIncludes as string), {
              timeout: left(),
            })
          if (a.loadState !== undefined)
            await page.waitForLoadState(a.loadState as 'load', { timeout: left() })
          if (a.text !== undefined)
            await page
              .getByText(a.text as string)
              .first()
              .waitFor({ state, timeout: left() })
          if (a.ref !== undefined)
            await locate(tab, page, a.ref as string).waitFor({ state, timeout: left() })
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'handle_dialog',
        description:
          'Say how to answer the next alert/confirm/prompt dialog of this tab (accept or dismiss, with promptText for prompts). If a dialog is already open it is answered now. An unhandled dialog is dismissed after 10 s and reported in the next result.',
        props: {
          tabId,
          accept: { type: 'boolean', description: 'Accept (true) or dismiss (false).' },
          promptText: { type: 'string', description: 'Text for a prompt dialog.', maxLength: 2000 },
        },
        required: ['tabId', 'accept'],
      },
      async run(a, deps) {
        const tab = deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        const pending = tab.pendingDialog
        if (pending) {
          tab.pendingDialog = null
          await (a.accept === true
            ? pending.accept(a.promptText as string | undefined)
            : pending.dismiss())
          return { json: { ok: true, applied: 'to the open dialog' } }
        }
        tab.dialogPlan = {
          accept: a.accept === true,
          ...(a.promptText !== undefined ? { promptText: a.promptText as string } : {}),
        }
        return { json: { ok: true, applied: 'to the next dialog' } }
      },
    },
    {
      spec: {
        name: 'upload_file',
        description:
          'Put local file(s) into a file input (ref). Only files under {roots}, up to 50 MB each, are allowed; the bytes are passed to the page, not the path.',
        props: {
          tabId,
          ref,
          paths: {
            type: 'array',
            description: 'Absolute file paths (or ~/...).',
            maxItems: MAX_UPLOAD_FILES,
            minItems: 1,
            itemMaxLength: 1000,
          },
          timeoutMs,
        },
        required: ['tabId', 'ref', 'paths'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const files: Array<{
          name: string
          mimeType: string
          buffer: Buffer
        }> = []
        let total = 0
        for (const p of a.paths as string[]) {
          const file = openGuardedFile(p, deps.guard())
          try {
            total += file.size
            if (total > MAX_UPLOAD_TOTAL_BYTES)
              throw new ToolError('the files are too large together (100 MB)')
            files.push({ name: file.name, mimeType: mimeFor(file.name), buffer: file.readAll() })
          } finally {
            file.close()
          }
        }
        const { notes } = await onTab(deps, a.tabId as string, ({ tab, page }) =>
          locate(tab, page, a.ref as string).setInputFiles(files, { timeout: ms }),
        )
        return withNotes({ ok: true, files: files.length }, notes)
      },
    },
    {
      spec: {
        name: 'download',
        description:
          'Start and save a download in one call: give exactly one of ref (click the element) or url (navigate this tab). Capture is armed before the action, so this works headless too; do not click or navigate first and wait afterwards in headless mode. Saved under {downloads}/<date>/; returns the saved path. Only the first download this tab starts during the call is taken; downloads in other tabs are never taken. Max 200 MB.',
        props: { tabId, ref, url, timeoutMs },
        required: ['tabId'],
      },
      async run(a, deps) {
        if ((a.ref === undefined) === (a.url === undefined))
          throw new ToolError('give exactly one of ref or url')
        const target = a.url === undefined ? undefined : checkUrl(a.url as string)
        const ms = timeoutOf(a)
        const { value, notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const loc = target === undefined ? locate(tab, page, a.ref as string) : null
          if (target !== undefined) tab.refs = null
          return deps.browser.captureDownloads(tab.profile, page, async () => {
            const startedAt = Date.now()
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: ms }),
              target === undefined
                ? loc!.click({ timeout: ms })
                : page
                    .goto(target, { waitUntil: 'commit', timeout: ms })
                    .catch((error: unknown) => {
                      // Chrome ends a navigation when it becomes a download. This
                      // alone is not success: the matching download must still arrive.
                      if (
                        !(error instanceof Error) ||
                        !/net::ERR_ABORTED|Download is starting/i.test(error.message)
                      )
                        throw error
                    }),
            ])
            dropPending(tab, download)
            return saveDownload(deps, download, ms, startedAt)
          })
        })
        return withNotes(value, notes)
      },
    },
    {
      spec: {
        name: 'wait_for_download',
        description:
          'Save the next download this tab starts WITHOUT a click on a ref (a script or a navigation started it). In headless mode, start this wait before the action (or in parallel): downloads outside an active call are denied, and a denied download cannot be recovered afterwards. For a click or navigation, use download with ref or url to arm capture and trigger the action in one call. In a visible window, an unclaimed download from the last 60 s also counts. Saved like download; returns the path. In a visible window a download that began BEFORE this call was already saved by Chrome in the private plugin downloads folder: the result then has savedBy:"chrome" and that file\'s path (call this tool first, or in parallel, to get a copy under the agent downloads folder). In a visible window only this tab\'s first download during the wait is taken (downloads in other tabs go to the private plugin downloads folder as usual); one the user starts in this same tab during the wait may be the one taken. Max 200 MB.',
        props: { tabId, timeoutMs },
        required: ['tabId'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const tab = deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        deps.browser.touch(tab.profile)
        const now = Date.now()
        tab.pendingDownloads = tab.pendingDownloads.filter((d) => now - d.at <= PENDING_DOWNLOAD_MS)
        const headless = deps.browser.state(tab.profile)?.mode === 'headless'
        // Before this call headless downloads were denied. A stale failed event
        // must not immediately consume the newly armed wait and hide its trigger.
        const waiting = headless ? undefined : tab.pendingDownloads.shift()
        if (headless) tab.pendingDownloads = []
        return {
          json: await deps.browser.captureDownloads(tab.profile, tab.page, async () => {
            const startedAt = waiting?.at ?? Date.now()
            const download =
              waiting?.download ?? (await tab.page.waitForEvent('download', { timeout: ms }))
            dropPending(tab, download)
            return deps.browser.operate(tab.profile, () =>
              saveDownload(deps, download, ms, startedAt),
            )
          }),
        }
      },
    },
    {
      spec: {
        name: 'download_url',
        description:
          "Fetch a file by URL with the profile's cookies (signed-in downloads, e.g. a PDF link) and save it like download. Give tabId, or profile (uses one of its open tabs). http(s) only, max 200 MB, the file is not opened in a tab.",
        props: {
          tabId: { ...tabId, description: "A tab whose profile's cookies are used." },
          profile: profileName,
          url,
          timeoutMs,
        },
        required: ['url'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        if ((a.tabId === undefined) === (a.profile === undefined))
          throw new ToolError('give exactly one of tabId and profile')
        const target = checkUrl(a.url as string)
        if (target === 'about:blank') throw new ToolError('the URL is not valid')
        let tab
        if (a.tabId !== undefined) tab = deps.tabs.resolve(a.tabId as string, generationOf(deps))
        else {
          usableProfile(deps, a.profile as string)
          tab = deps.tabs.list(generationOf(deps), a.profile as string)[0]
          if (!tab)
            throw new ToolError(
              `profile "${a.profile as string}" has no open tab — call open_tab first`,
            )
        }
        usableProfile(deps, tab.profile)
        deps.browser.touch(tab.profile)
        const t = tab
        return {
          json: await deps.browser.operate(t.profile, () =>
            fetchToDisk(deps, t.page.context(), target, ms),
          ),
        }
      },
    },
    {
      spec: {
        name: 'mouse',
        description:
          'Pointer input at viewport coordinates (pixels from the top-left of what screenshot shows), for canvases and elements without a ref. action: click, double_click, move, drag (from x,y to x2,y2) or scroll (wheel at x,y by dx=x2, dy=y2 pixels, positive = right/down). Headless: nothing is focused or brought to the front.',
        props: {
          tabId,
          action: {
            type: 'string',
            description: 'click, double_click, move, drag or scroll.',
            enum: ['click', 'double_click', 'move', 'drag', 'scroll'],
          },
          x: { type: 'number', description: 'X in viewport pixels.', min: 0, max: 20000 },
          y: { type: 'number', description: 'Y in viewport pixels.', min: 0, max: 20000 },
          x2: {
            type: 'number',
            description: 'drag: end X. scroll: horizontal pixels (dx).',
            min: -20000,
            max: 20000,
          },
          y2: {
            type: 'number',
            description: 'drag: end Y. scroll: vertical pixels (dy).',
            min: -20000,
            max: 20000,
          },
          button: {
            type: 'string',
            description: 'left (default), right or middle.',
            enum: ['left', 'right', 'middle'],
          },
          timeoutMs,
        },
        required: ['tabId', 'action', 'x', 'y'],
      },
      async run(a, deps) {
        const action = a.action as string
        const x = a.x as number,
          y = a.y as number
        const x2 = a.x2 as number | undefined,
          y2 = a.y2 as number | undefined
        if (action === 'drag' && (x2 === undefined || y2 === undefined))
          throw new ToolError('drag needs x2 and y2')
        if (action === 'scroll' && x2 === undefined && y2 === undefined)
          throw new ToolError('scroll needs x2 and/or y2 (the pixels to scroll)')
        if (action !== 'drag' && action !== 'scroll' && (x2 !== undefined || y2 !== undefined))
          throw new ToolError('x2 and y2 are only for drag and scroll')
        if (
          action !== 'click' &&
          action !== 'double_click' &&
          a.button !== undefined &&
          action !== 'drag'
        )
          throw new ToolError('button is only for click, double_click and drag')
        const button = (a.button as 'left' | 'right' | 'middle' | undefined) ?? 'left'
        const { notes } = await onTab(deps, a.tabId as string, async ({ page }) => {
          const run = async (): Promise<void> => {
            if (action === 'move') await page.mouse.move(x, y)
            else if (action === 'click') await page.mouse.click(x, y, { button })
            else if (action === 'double_click') await page.mouse.dblclick(x, y, { button })
            else if (action === 'drag') {
              await page.mouse.move(x, y)
              await page.mouse.down({ button })
              await page.mouse.move(x2 as number, y2 as number, { steps: 10 })
              await page.mouse.up({ button })
            } else {
              await page.mouse.move(x, y)
              await page.mouse.wheel(x2 ?? 0, y2 ?? 0)
            }
          }
          await raceTimeout(run(), timeoutOf(a))
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'console',
        description:
          'The last 200 console lines of the tab (type and text). Pass the "last" of an earlier call as since to get only new lines.',
        props: { tabId, since },
        required: ['tabId'],
      },
      async run(a, deps) {
        const tab = deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        return {
          json: {
            last: tab.console.lastSeq,
            lines: tab.console.since(a.since as number | undefined),
          },
        }
      },
    },
    {
      spec: {
        name: 'network',
        description: `Requests of the tab, newest first: method, URL without query, status (0 = failed, null = pending), type. No headers and no bodies. At most ${DEFAULT_NETWORK_LIMIT} unless limit is given (max 200; the tab keeps its last 200); type / urlIncludes narrow it down first, and "omitted" counts the matching ones left out.`,
        props: { tabId, since, limit: networkLimit, type: networkType, urlIncludes },
        required: ['tabId'],
      },
      async run(a, deps) {
        const tab = deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        const type = typeof a.type === 'string' ? a.type.toLowerCase() : null
        const needle = typeof a.urlIncludes === 'string' ? a.urlIncludes.toLowerCase() : null
        const limit = typeof a.limit === 'number' ? a.limit : DEFAULT_NETWORK_LIMIT
        const matching = tab.network
          .since(a.since as number | undefined)
          .filter(
            (r) =>
              (type === null || r.type.toLowerCase() === type) &&
              (needle === null || r.url.toLowerCase().includes(needle)),
          )
        const requests = matching.slice(-limit).reverse()
        const omitted = matching.length - requests.length
        return {
          json: { last: tab.network.lastSeq, requests, ...(omitted > 0 ? { omitted } : {}) },
        }
      },
    },
  ]
}
export const MAX_PROFILES = 20
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
function dropPending(tab: TabState, download: Download): void {
  tab.pendingDownloads = tab.pendingDownloads.filter((d) => d.download !== download)
}
class DownloadTooLarge extends Error {}
const MAX_REDIRECTS = 10
async function fetchToDisk(
  deps: ToolDeps,
  ctx: BrowserContext,
  start: string,
  ms: number,
): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(ms)
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const cookie = (await ctx.cookies(url)).map((c) => `${c.name}=${c.value}`).join('; ')
    const res = await fetch(url, { redirect: 'manual', signal, headers: cookie ? { cookie } : {} })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => undefined)
      url = checkUrl(new URL(res.headers.get('location') as string, url).href)
      continue
    }
    try {
      if (!res.ok || !res.body) throw new ToolError(`the server answered ${res.status}`)
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES)
        throw new ToolError('the file is larger than 200 MB and was not saved')
      const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
        res.headers.get('content-disposition') ?? '',
      )?.[1]
      let urlName = ''
      try {
        urlName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
      } catch {
        /* Continue without this optional result. */
      }
      const dir = path.join(deps.downloadsRoot, dayFolder((deps.now ?? (() => new Date()))()))
      privateFolder(path.dirname(deps.downloadsRoot), deps.downloadsRoot, true)
      privateFolder(deps.downloadsRoot, dir, true)
      const { fd, target } = reserveFile(
        dir,
        sanitizeDownloadName(disposition ? safeDecode(disposition) : urlName),
      )
      let bytes = 0
      const cap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length
          if (bytes > MAX_DOWNLOAD_BYTES) cb(new DownloadTooLarge())
          else cb(null, chunk)
        },
      })
      try {
        await pipeline(
          Readable.fromWeb(res.body as never),
          cap,
          fs.createWriteStream(target, { fd }),
        )
      } catch (e) {
        fs.rmSync(target, { force: true })
        if (e instanceof DownloadTooLarge)
          throw new ToolError('the file is larger than 200 MB and was discarded')
        throw e
      }
      return {
        path: target,
        bytes,
        status: res.status,
        contentType: res.headers.get('content-type'),
      }
    } finally {
      await res.body?.cancel().catch(() => undefined)
    }
  }
  throw new ToolError('too many redirects')
}
function chromeNameMatches(wanted: string, found: string): boolean {
  if (found === wanted) return true
  const ext = path.extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  return (
    found.startsWith(`${stem} (`) &&
    found.endsWith(`)${ext}`) &&
    /^\d{1,4}$/.test(found.slice(stem.length + 2, found.length - ext.length - 1))
  )
}
function nativeDownload(
  deps: ToolDeps,
  suggested: string,
  startedAt: number,
): Record<string, unknown> {
  const dir = deps.nativeDownloads ?? deps.downloadsRoot
  privateFolder(deps.downloadsRoot, dir)
  let best: {
    target: string
    bytes: number
    mtime: number
  } | null = null
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!chromeNameMatches(suggested, f)) continue
      const target = path.join(dir, f)
      const st = fs.statSync(target)
      if (st.isFile() && st.mtimeMs >= startedAt - 2000 && (!best || st.mtimeMs > best.mtime))
        best = { target, bytes: st.size, mtime: st.mtimeMs }
    }
  } catch {
    /* Continue without this optional result. */
  }
  if (!best)
    throw new ToolError(
      'Chrome saved the download itself, but the file was not found in the plugin downloads folder',
    )
  return { path: best.target, bytes: best.bytes, savedBy: 'chrome' }
}
async function saveDownload(
  deps: ToolDeps,
  download: Download,
  ms: number,
  startedAt: number,
): Promise<Record<string, unknown>> {
  let tmp: string | null
  try {
    tmp = await raceTimeout(download.path(), ms)
  } catch (e) {
    await download.cancel().catch(() => undefined)
    throw e
  }
  if (!tmp) throw new ToolError('the download failed')
  if (!fs.existsSync(tmp)) return nativeDownload(deps, download.suggestedFilename(), startedAt)
  const tooLarge = new ToolError('the download is larger than 200 MB and was discarded')
  try {
    if (fs.statSync(tmp).size > MAX_DOWNLOAD_BYTES) throw tooLarge
    const source = await download.createReadStream()
    if (!source) throw new ToolError('the download failed')
    const dir = path.join(deps.downloadsRoot, dayFolder((deps.now ?? (() => new Date()))()))
    privateFolder(path.dirname(deps.downloadsRoot), deps.downloadsRoot, true)
    privateFolder(deps.downloadsRoot, dir, true)
    const { fd, target } = reserveFile(dir, sanitizeDownloadName(download.suggestedFilename()))
    let bytes = 0
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length
        if (bytes > MAX_DOWNLOAD_BYTES) cb(new DownloadTooLarge())
        else cb(null, chunk)
      },
    })
    try {
      await pipeline(source, cap, fs.createWriteStream(target, { fd }))
    } catch (e) {
      fs.rmSync(target, { force: true })
      throw e instanceof DownloadTooLarge ? tooLarge : e
    }
    return { path: target, bytes }
  } finally {
    await download.delete().catch(() => undefined)
  }
}
export function allToolDefs(): ToolDef[] {
  return [...buildToolDefs(), ...buildProfileToolDefs(), ...buildShowHideDefs()]
}
export const TOOL_NAMES = allToolDefs().map((d) => d.spec.name)
export function createAgentChromeTools(deps: ToolDeps): ToolHandler[] {
  const roots = (): string => {
    try {
      return deps.guard().roots.join(', ')
    } catch {
      return 'the allowed folder'
    }
  }
  const fill = (text: string): string =>
    text.replace('{downloads}', () => deps.downloadsRoot).replace('{roots}', roots)
  return allToolDefs().map((def) => ({
    definition: {
      name: def.spec.name,
      description: fill(def.spec.description),
      inputSchema: jsonSchemaOf(def.spec),
    },
    async execute(rawArgs): Promise<ToolResult> {
      let ms: number | undefined
      try {
        const args = parseArgs(def.spec, rawArgs)
        ms = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
        const out = await def.run(args, deps)
        if ('image' in out) {
          return {
            content: [
              { type: 'image', data: out.image.toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: out.caption },
            ],
          } as unknown as ToolResult
        }
        return { content: [{ type: 'text', text: 'text' in out ? out.text : jsonValue(out.json) }] }
      } catch (e) {
        throw new PublicToolError(describeError(e, ms ?? DEFAULT_TIMEOUT_MS))
      }
    },
  }))
}
