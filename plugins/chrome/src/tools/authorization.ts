import { createWindowTasks } from '../windows.js'
import { ToolError } from './schema.js'
import type { ToolDef, ToolDeps } from './common.js'
import type { TabState } from '../tabs.js'

const unavailable = () =>
  new ToolError('profile is unavailable — check Settings → Plugins → Chrome')
type SharedAccess = { authorization(name: string): string }
export function sharedAccess(deps: Pick<ToolDeps, 'store'>): SharedAccess | undefined {
  return (deps.store as unknown as { shared?: SharedAccess }).shared
}
const browserIdentities = new WeakMap<object, object>()
export function browserIdentity(browser: object): object {
  return browserIdentities.get(browser) ?? browser
}
const checks = new WeakMap<ToolDeps, () => void>()
export function checkToolAuthorization(deps: ToolDeps): void {
  checks.get(deps)?.()
}

/** Each call keeps its admission identities. Old callbacks cannot adopt new permission epochs. */
export function fenceToolDefs(defs: ToolDef[]): ToolDef[] {
  const fenced: ToolDef[] = defs.map((def) => ({
    ...def,
    async run(args, deps) {
      const shared = sharedAccess(deps)
      if (!shared) return def.run(args, deps)
      const admitted = new Map<string, string>()
      const admit = (name: string) => {
        try {
          if (!deps.store.get(name)?.enabled) throw unavailable()
          const token = shared.authorization(name)
          const old = admitted.get(name)
          if (old !== undefined && old !== token) throw unavailable()
          admitted.set(name, token)
        } catch {
          throw unavailable()
        }
      }
      const check = () => {
        for (const name of admitted.keys()) admit(name)
      }
      if (typeof args.profile === 'string') admit(args.profile)
      const originals = new WeakMap<object, object>()
      const unwrap = (v: unknown): unknown => {
        if (!v || typeof v !== 'object') return v
        const raw = originals.get(v)
        if (raw) return raw
        if (Array.isArray(v)) return v.map(unwrap)
        if (Object.getPrototypeOf(v) === Object.prototype)
          return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, unwrap(value)]))
        return v
      }
      // Playwright methods return nested handles (locators, keyboard, mouse, context, download).
      // Guard the handles too, so every subsequent command rechecks after the preceding await.
      const handles = new WeakMap<object, Map<string, object>>()
      const handle = (value: unknown, name: string, generation: number | null): unknown => {
        if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || 'pipe' in value)
          return value
        if (Array.isArray(value)) return value.map((v) => handle(v, name, generation))
        // Values and streams are data, not browser handles.
        if (
          Object.getPrototypeOf(value) === Object.prototype &&
          !Object.values(value).some((v) => typeof v === 'function')
        )
          return value
        const valid = () => {
          check()
          if ((deps.browser.state(name)?.generation ?? null) !== generation) throw unavailable()
        }
        const key = `${name}:${generation}`
        let cached = handles.get(value)
        if (!cached) handles.set(value, (cached = new Map()))
        if (cached.has(key)) return cached.get(key)
        const proxy = new Proxy(value, {
          get(target, prop) {
            const field = Reflect.get(target, prop, target)
            if (typeof field !== 'function') return handle(field, name, generation)
            return (...input: unknown[]) => {
              valid()
              const out = Reflect.apply(field, target, input.map(unwrap))
              if (out && typeof out === 'object' && 'then' in out && typeof out.then === 'function')
                return Promise.resolve(out).then((result: unknown) => {
                  valid()
                  return handle(result, name, generation)
                })
              return handle(out, name, generation)
            }
          },
        })
        cached.set(key, proxy)
        originals.set(proxy, value)
        return proxy
      }
      const tab = (raw: TabState): TabState => {
        admit(raw.profile)
        return new Proxy(raw, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target)
            if (prop === 'page' || prop === 'pendingDialog')
              return handle(value, raw.profile, raw.generation)
            if (prop === 'pendingDownloads')
              return raw.pendingDownloads.map((d) => ({
                ...d,
                download: handle(d.download, raw.profile, raw.generation),
              }))
            return value
          },
          set(target, prop, value) {
            check()
            return Reflect.set(target, prop, unwrap(value), target)
          },
        })
      }
      const browser = new Proxy(deps.browser, {
        get(target, prop) {
          const field = Reflect.get(target, prop, target)
          if (typeof field !== 'function') return field
          // These are long-lived observer registrations, not work belonging to this call.
          if (
            prop === 'onPage' ||
            prop === 'onClosed' ||
            prop === 'privateDownloadsActive' ||
            prop === 'downloadIsPrivate' ||
            prop === 'deletePrivateDownload'
          )
            return field.bind(target)
          return (...input: unknown[]) => {
            check()
            const name = input[0] as string
            if (prop !== 'state' && prop !== 'dir') admit(name)
            const generation = deps.browser.state(name)?.generation ?? null
            const parameters = input.map((v) =>
              typeof v === 'function'
                ? (...values: unknown[]) => {
                    check()
                    return v(...values)
                  }
                : unwrap(v),
            )
            const out = Reflect.apply(field, target, parameters)
            const done = (result: unknown) => {
              check()
              if (prop === 'newPage') {
                if ((deps.browser.state(name)?.generation ?? null) !== generation)
                  throw unavailable()
                return handle(result, name, generation)
              }
              return result
            }
            return out && typeof out === 'object' && 'then' in out && typeof out.then === 'function'
              ? Promise.resolve(out).then(done)
              : done(out)
          }
        },
      })
      browserIdentities.set(browser, deps.browser)
      const tabs = new Proxy(deps.tabs, {
        get(target, prop) {
          const field = Reflect.get(target, prop, target)
          if (typeof field !== 'function') return field
          return (...input: unknown[]) => {
            check()
            const out = Reflect.apply(field, target, input.map(unwrap))
            if (prop === 'resolve' || prop === 'add') return tab(out as TabState)
            if (prop === 'list')
              return (out as TabState[]).filter((t) => deps.store.get(t.profile)?.enabled).map(tab)
            return out
          }
        },
      })
      const store = new Proxy(deps.store, {
        get(target, prop) {
          const field = Reflect.get(target, prop, target)
          if (typeof field !== 'function') return field
          return (...input: unknown[]) => {
            check()
            const result = Reflect.apply(field, target, input)
            if (prop === 'remove') admitted.delete(input[0] as string)
            return result
          }
        },
      })
      const scoped: ToolDeps = {
        ...deps,
        store,
        browser,
        tabs,
        windows: createWindowTasks({ browser }),
      }
      checks.set(scoped, check)
      const out = await def.run(args, scoped)
      check()
      return out
    },
  }))
  return fenced.map((def) => ({
    ...def,
    async run(args, deps) {
      const call = deps.browser.agentCall
      if (!call) return def.run(args, deps)
      let profiles: string[]
      if (typeof args.profile === 'string') profiles = [args.profile]
      else if (typeof args.tabId === 'string')
        profiles = [
          deps.tabs.resolve(args.tabId, (name) => deps.browser.state(name)?.generation ?? null)
            .profile,
        ]
      else
        profiles = deps.store
          .list()
          .filter((p) => p.enabled)
          .map((p) => p.name)
      return deps.browser.agentCall!(profiles, () => def.run(args, deps))
    },
  }))
}
