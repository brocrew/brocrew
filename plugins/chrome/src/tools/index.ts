import { fenceToolDefs, sharedAccess } from './authorization.js'
import { PublicToolError } from '../shared/toolServer.js'
import { WindowTargetError } from '../shared/browser/chromiumWindows.js'
import { LocalFileGuardError } from '../localFileGuard.js'
import { BrowserNotFoundError, ProfileInUseError } from '../browser/profileBrowser.js'
import { OperationBlockedError } from '../shared/browser/browser-lease.js'
import { ProfileInUseElsewhereError } from '../profiles/sharedStore.js'
import { answerDialog, TabError } from '../tabs.js'
import { randomBytes } from 'node:crypto'
import type { ToolHandler, ToolResult } from '../shared/toolServer.js'
import { openGuardedFile } from '../localFileGuard.js'
import { MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES, mimeFor } from '../files.js'
import { MAX_TEXT, ToolError, jsonSchemaOf, parseArgs } from './schema.js'
import {
  DEFAULT_NETWORK_LIMIT,
  DEFAULT_TIMEOUT_MS,
  KEY,
  MAX_SCREENSHOT_BYTES,
  checkUrl,
  checkDownloadUrl,
  describeError,
  generationOf,
  jsonValue,
  locate,
  onTab,
  openDialogNote,
  useTab,
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
import { buildShowTabDefs } from './showTab.js'
import { PENDING_DOWNLOAD_MS } from '../tabs.js'
import { dropPending, fetchToDisk, saveDownload } from './downloads.js'
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
  return fenceToolDefs([
    {
      spec: {
        name: 'list_browser_profiles',
        description:
          'List the Chrome profiles: name, description, whether the user enabled it, temporary or not, open or closed. Only enabled profiles can be used.',
        props: {},
      },
      async run(_a, deps) {
        return {
          json: deps.store
            .list()
            .filter((p) => !sharedAccess(deps) || p.enabled)
            .map((p) => {
              const s = deps.browser.state(p.name)
              return {
                name: p.name,
                displayName: p.displayName ?? p.name,
                description: p.description,
                temporary: p.temporary,
                enabled: p.enabled,
                allowExtensions: p.allowExtensions,
                allowSettings: p.allowSettings,
                open: s !== null,
              }
            }),
        }
      },
    },
    {
      spec: {
        name: 'create_browser_profile',
        description:
          'Create a new empty Chrome profile (one per account). Shared profiles start enabled in this workspace. Workspace-local profiles start disabled: the user enables them in Settings → Plugins → Chrome. temporary:true instead makes a throwaway profile that is enabled at once, never signed in and without extensions or settings access; it is deleted when the server restarts or by delete_browser_profile. name is optional for a temporary profile (tmp-xxxxxx).',
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
                : sharedAccess(deps)
                  ? 'created enabled in this workspace (signing in is optional)'
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
        description: `Set the description of an available profile: a plain-text label of what the profile is for, at most ${DESCRIPTION_MAX} characters, shown in list_browser_profiles and the Plugins screen. An empty string clears it.`,
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
          'Open a background tab at an HTTP(S)/file URL or absolute local path. Returns tabId, numeric windowId, url and title. If later work fails, TAB_CREATED identifies the existing tab. windowOf selects an existing tab’s window and fails clearly if the helper cannot place it there; it never opens elsewhere as a fallback. Otherwise use Chrome’s most recently active available window. Chrome is never brought forward. newWindow:true opens a separate window.',
        props: {
          profile: profileName,
          url,
          windowOf: {
            ...tabId,
            description:
              'Open in this live tab’s window, in the same profile. Fails if the helper cannot place it there. Cannot accompany newWindow:true.',
          },
          newWindow: {
            type: 'boolean',
            description: 'Open in a new window.',
          },
        },
        required: ['profile', 'url'],
      },
      async run(a, deps) {
        const name = a.profile as string
        const target = checkUrl(a.url as string)
        if (a.windowOf !== undefined && a.newWindow === true)
          throw new ToolError('give either newWindow:true or windowOf, not both')
        const selectedAnchor = () => {
          if (a.windowOf === undefined) return undefined
          const tab = deps.tabs.resolve(a.windowOf as string, generationOf(deps))
          if (tab.profile !== name)
            throw new ToolError('windowOf must name a tab in the requested profile')
          return tab
        }
        selectedAnchor()
        usableProfile(deps, name)
        deps.tabs.watch(name, deps.browser)
        const out = await deps.browser.exclusive(name, async () => {
          usableProfile(deps, name)
          selectedAnchor()
          const { generation } = await deps.browser.ensure(name)
          deps.activity?.('browser-ready')
          usableProfile(deps, name)
          let openingNote: string | undefined
          const page = await deps.browser.newPage(name, {
            newWindow: a.newWindow === true,
            windowOf: selectedAnchor()?.page,
            onNote: (note) => {
              openingNote = note
            },
          })
          const tab = deps.tabs.add(name, generation, page)
          try {
            await deps.browser.usePage(name, page)
            deps.activity?.('page-ready')
            usableProfile(deps, name)
            let loadError: string | undefined
            try {
              await page.goto(target, {
                waitUntil: 'domcontentloaded',
                timeout: DEFAULT_TIMEOUT_MS,
              })
              deps.activity?.('page-loaded')
            } catch (e) {
              loadError = openDialogNote(tab) ?? describeError(e)
            }
            return {
              tabId: tab.id,
              windowId: await deps.browser.windowId(name, page),
              url: page.url(),
              title: await titleAfterLoad(page),
              ...(openDialogNote(tab) ? { dialog: openDialogNote(tab) } : {}),
              ...(loadError ? { loadError } : {}),
              ...(openingNote ? { note: openingNote } : {}),
            }
          } catch (error) {
            throw new ToolError(`TAB_CREATED ${tab.id}: ${describeError(error)}`)
          }
        })
        return { json: out }
      },
    },
    {
      spec: {
        name: 'list_tabs',
        description:
          'List open tabs (tabId, numeric windowId, profile, url, title) of enabled profiles, or one profile. Read-only; does not change recent-window preference.',
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
              windowId: await deps.browser.windowId(t.profile, t.page),
              profile: t.profile,
              url: t.page.url(),
              title: await titleOf(t.page),
              ...(openDialogNote(t) ? { dialog: openDialogNote(t) } : {}),
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
          const opts = {
            waitUntil: 'domcontentloaded' as const,
            timeout: ms,
          }
          const history = { waitUntil: 'commit' as const, timeout: ms }
          tab.refs = null
          const navigating =
            target !== undefined
              ? page.goto(target, opts)
              : a.action === 'back'
                ? page.goBack(history)
                : a.action === 'forward'
                  ? page.goForward(history)
                  : page.reload(opts)
          const res = await navigating.catch((error: unknown) => {
            throw new ToolError(
              `NAVIGATION_FAILED ${tab.id}: ${describeError(error)}; current URL ${page.url()}`,
            )
          })
          deps.activity?.('page-loaded')
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
          mode: {
            type: 'string',
            description: 'aria (default) or text.',
            enum: ['aria', 'text'],
          },
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
          return {
            header: await head(),
            body: f.body + moreMarker('snapshot', f.next),
          }
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
          text: {
            type: 'string',
            description: 'The new value.',
            maxLength: MAX_TEXT,
          },
          submit: {
            type: 'boolean',
            description: 'Press Enter after filling.',
          },
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
          text: {
            type: 'string',
            description: 'Text to type.',
            maxLength: 10000,
          },
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
          key: {
            type: 'string',
            description: 'Key name or chord.',
            pattern: KEY,
          },
          ref,
          timeoutMs,
        },
        required: ['tabId', 'key'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const { notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          if (a.ref !== undefined)
            await locate(tab, page, a.ref as string).press(a.key as string, {
              timeout: ms,
            })
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
            await locate(tab, page, a.ref as string).scrollIntoViewIfNeeded({
              timeout: ms,
            })
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
        const { value, notes } = await onTab(deps, a.tabId as string, async ({ tab, page }) => {
          const png =
            a.scope === 'element'
              ? await locate(tab, page, a.ref as string).screenshot({
                  timeout: ms,
                })
              : await page.screenshot({
                  fullPage: a.scope === 'full',
                  timeout: ms,
                })
          deps.activity?.('screenshot-captured')
          if (png.length > MAX_SCREENSHOT_BYTES)
            throw new ToolError('the screenshot is too large — use scope viewport or element')
          return png
        })
        return {
          image: value,
          caption: `${a.scope as string} screenshot of ${a.tabId as string}${notes.length ? `\nnotes: ${notes.join('; ')}` : ''}`,
        }
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
        return {
          text: value + (notes.length ? `\nnotes: ${notes.join('; ')}` : ''),
        }
      },
    },
    {
      spec: {
        name: 'wait_for',
        description:
          'Wait until text appears/disappears, an element (ref) is visible/hidden, the URL contains a string, and/or the page reaches a load state. At least one condition.',
        props: {
          tabId,
          text: {
            type: 'string',
            description: 'Text to wait for.',
            minLength: 1,
            maxLength: 500,
          },
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
            await page.waitForLoadState(a.loadState as 'load', {
              timeout: left(),
            })
          if (a.text !== undefined)
            await page
              .getByText(a.text as string)
              .first()
              .waitFor({ state, timeout: left() })
          if (a.ref !== undefined)
            await locate(tab, page, a.ref as string).waitFor({
              state,
              timeout: left(),
            })
        })
        return withNotes({ ok: true }, notes)
      },
    },
    {
      spec: {
        name: 'handle_dialog',
        description:
          'Say how to answer the next alert/confirm/prompt dialog of this tab (accept or dismiss, with promptText for prompts). If a dialog is already open it is answered now. An unhandled dialog stays open until explicitly answered; page actions report the open dialog and may be blocked until handle_dialog answers it.',
        props: {
          tabId,
          accept: {
            type: 'boolean',
            description: 'Accept (true) or dismiss (false).',
          },
          promptText: {
            type: 'string',
            description: 'Text for a prompt dialog.',
            maxLength: 2000,
          },
        },
        required: ['tabId', 'accept'],
      },
      async run(a, deps) {
        const tab = await useTab(deps, a.tabId as string)
        deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        const applied = await answerDialog(tab, {
          accept: a.accept === true,
          ...(a.promptText !== undefined ? { promptText: a.promptText as string } : {}),
        })
        return { json: { ok: true, applied: `to the ${applied} dialog` } }
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
            files.push({
              name: file.name,
              mimeType: mimeFor(file.name),
              buffer: file.readAll(),
            })
          } finally {
            file.close()
          }
        }
        const { notes } = await onTab(deps, a.tabId as string, ({ tab, page }) =>
          locate(tab, page, a.ref as string).setInputFiles(files, {
            timeout: ms,
          }),
        )
        return withNotes({ ok: true, files: files.length }, notes)
      },
    },
    {
      spec: {
        name: 'download',
        description:
          'Start and save a download in one call: give exactly one of ref (click the element) or url (navigate this tab). Capture is armed before the action. Saved under {downloads}/<date>/; returns the saved path. Only the first download this tab starts during the call is taken; downloads in other tabs are never taken. Max 200 MB.',
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
          let savedFile: string | undefined
          const save = async () => {
            const startedAt = Date.now()
            const [download] = await Promise.all([
              page.waitForEvent('download', {
                timeout: ms,
                predicate: (download) =>
                  deps.browser.downloadIsPrivate?.(tab.profile, download) ?? true,
              }),
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
            return saveDownload(
              deps,
              tab.profile,
              download,
              ms,
              startedAt,
              (file) => {
                savedFile = file
              },
              typeof a.timeoutMs === 'number' ? ms : undefined,
            )
          }
          return deps.browser.captureDownloads(
            tab.profile,
            page,
            save,
            () => savedFile,
            () => deps.activity?.('download-received'),
          )
        })
        return withNotes(value, notes)
      },
    },
    {
      spec: {
        name: 'wait_for_download',
        description:
          'Wait for and save a download this tab starts independently, from a page timer or script, or from a user in a visible window. For an agent-triggered click or navigation, use download with ref or url to arm capture and trigger the action in one call. Only one tool call runs at a time: another tool cannot trigger the download while this wait is active. A private download from an earlier agent call in the last 60 s also counts. Saved like download; returns the path. A private download kept before this call can return savedBy:"chrome" with its private path. Downloads begun outside an agent call use normal Chrome downloads and are not taken by this tool. Start the wait before an independent event to get a copy under the agent downloads folder. Only this tab\'s first download during the wait is taken (downloads in other tabs go to the private plugin downloads folder as usual); one the user starts in this same tab during the wait may be the one taken. Max 200 MB.',
        props: { tabId, timeoutMs },
        required: ['tabId'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        const tab = await useTab(deps, a.tabId as string)
        deps.tabs.resolve(a.tabId as string, generationOf(deps))
        usableProfile(deps, tab.profile)
        const now = Date.now()
        tab.pendingDownloads = tab.pendingDownloads.filter((d) => now - d.at <= PENDING_DOWNLOAD_MS)
        const waiting = tab.pendingDownloads.shift()
        let savedFile: string | undefined
        const save = async () => {
          const startedAt = waiting?.at ?? Date.now()
          const download =
            waiting?.download ??
            (await tab.page.waitForEvent('download', {
              timeout: ms,
              predicate: (download) =>
                deps.browser.downloadIsPrivate?.(tab.profile, download) ?? true,
            }))
          dropPending(tab, download)
          return deps.browser.operate(tab.profile, () =>
            saveDownload(
              deps,
              tab.profile,
              download,
              ms,
              startedAt,
              (file) => {
                savedFile = file
              },
              typeof a.timeoutMs === 'number' ? ms : undefined,
            ),
          )
        }
        return {
          json: await deps.browser.captureDownloads(
            tab.profile,
            tab.page,
            save,
            () => savedFile,
            () => deps.activity?.('download-received'),
            waiting ? { download: waiting.download, signal: deps.signal } : undefined,
          ),
        }
      },
    },
    {
      spec: {
        name: 'download_url',
        description:
          "Fetch a file by URL with the profile's cookies (signed-in downloads, e.g. a PDF link) and save it like download. Give tabId, or profile (uses one of its open tabs). http(s) only, max 200 MB, the file is not opened in a tab.",
        props: {
          tabId: {
            ...tabId,
            description: "A tab whose profile's cookies are used.",
          },
          profile: profileName,
          url: {
            ...url,
            description: 'HTTP(S) URL only; file URLs and local paths are not supported.',
          },
          timeoutMs,
        },
        required: ['url'],
      },
      async run(a, deps) {
        const ms = timeoutOf(a)
        if ((a.tabId === undefined) === (a.profile === undefined))
          throw new ToolError('give exactly one of tabId and profile')
        const target = checkDownloadUrl(a.url as string)
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
        const t = tab
        return {
          json: await deps.browser.operate(t.profile, async () => {
            await deps.browser.usePage(t.profile, t.page)
            deps.tabs.resolve(t.id, generationOf(deps))
            usableProfile(deps, t.profile)
            return fetchToDisk(
              deps,
              t.page.context(),
              target,
              typeof a.timeoutMs === 'number' ? ms : undefined,
            )
          }),
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
          x: {
            type: 'number',
            description: 'X in viewport pixels.',
            min: 0,
            max: 20000,
          },
          y: {
            type: 'number',
            description: 'Y in viewport pixels.',
            min: 0,
            max: 20000,
          },
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
              await page.mouse.move(x2 as number, y2 as number, {
                steps: 10,
              })
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
        const tab = await useTab(deps, a.tabId as string)
        deps.tabs.resolve(a.tabId as string, generationOf(deps))
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
        props: {
          tabId,
          since,
          limit: networkLimit,
          type: networkType,
          urlIncludes,
        },
        required: ['tabId'],
      },
      async run(a, deps) {
        const tab = await useTab(deps, a.tabId as string)
        deps.tabs.resolve(a.tabId as string, generationOf(deps))
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
          json: {
            last: tab.network.lastSeq,
            requests,
            ...(omitted > 0 ? { omitted } : {}),
          },
        }
      },
    },
  ])
}
export const MAX_PROFILES = 20
export function allToolDefs(): ToolDef[] {
  return [...buildToolDefs(), ...buildProfileToolDefs(), ...buildShowTabDefs()]
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
    async execute(rawArgs, context): Promise<ToolResult> {
      try {
        const args = parseArgs(def.spec, rawArgs)
        const out = await def.run(args, {
          ...deps,
          signal: context.signal,
          activity: context.activity,
        })
        if ('image' in out) {
          return {
            content: [
              {
                type: 'image',
                data: out.image.toString('base64'),
                mimeType: 'image/png',
              },
              { type: 'text', text: out.caption },
            ],
          } as unknown as ToolResult
        }
        return {
          content: [
            {
              type: 'text',
              text: 'text' in out ? out.text : jsonValue(out.json),
            },
          ],
        }
      } catch (e) {
        if (
          e instanceof WindowTargetError ||
          e instanceof ToolError ||
          e instanceof TabError ||
          e instanceof LocalFileGuardError ||
          e instanceof ProfileInUseError ||
          e instanceof ProfileInUseElsewhereError ||
          e instanceof BrowserNotFoundError
        )
          throw new PublicToolError(e.message)
        if (e instanceof OperationBlockedError)
          throw new PublicToolError('the profile is being restarted — call again in a few seconds')
        throw e
      }
    },
  }))
}
