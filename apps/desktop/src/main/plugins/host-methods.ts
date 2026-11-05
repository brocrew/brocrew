import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PluginToolBinding } from './generic-manifest'
import type { AnyPluginManifest } from './generic-manifest'
import { PLUGIN_HOST_METHODS, PLUGIN_SLOTS } from '../../shared/plugin-contract'
import type {
  PluginBeforeTurnInput,
  PluginBeforeTurnResult,
  PluginHostRequest,
  PluginHostResult,
  PluginJsonObject,
  PluginToolCallResult,
  ToolBinding,
} from '../../shared/plugin-contract'
import type {
  PluginHostSnapshot,
  PluginContributionView,
  PluginNotificationView,
} from '../../shared/plugin-host'
import { pluginToolCallResult } from './tool-result'

export interface PluginHostOwner {
  pluginId: string
  runId: string
}
export interface PluginHostEnvelope {
  api: number
  workspaceId: string
  requestId: string
  method: string
  params: unknown
}
interface Contribution extends PluginContributionView {
  owner: PluginHostOwner
  workspaceId: string
}
interface Notification extends PluginNotificationView {
  owner: PluginHostOwner
  workspaceId: string
  bindings: Map<string, ToolBinding>
}
export interface PluginHostCall {
  workspaceId: string
  pluginId: string
  instanceId: string
  name: string
  arguments: PluginJsonObject
  requestId: string
  origin: string
}
const object = z.record(z.string(), z.json())
const registration = z.object({
  contributionId: z.string().min(1),
  kind: z.string().min(1),
  api: z.number(),
  definition: object,
})
const button = z.object({
  slot: z.string(),
  view: z.object({
    label: z.string(),
    icon: z.string().optional(),
    tooltip: z.string().optional(),
    disabled: z.boolean().optional(),
    busy: z.boolean().optional(),
  }),
  invoke: PluginToolBinding,
})
const settings = z.object({
  title: z.string(),
  entry: z.string(),
  assets: z.array(z.string()),
  fields: z.union([z.boolean(), object]).optional(),
})
const hook = z.object({ invoke: PluginToolBinding })
const notification = z.object({
  notificationId: z.string().optional(),
  title: z.string(),
  text: z.string(),
  level: z.enum(['info', 'warning', 'error']),
  actions: z
    .array(z.object({ id: z.string(), label: z.string(), invoke: PluginToolBinding }))
    .optional(),
})
const fail = (
  code: 'unsupported' | 'disabled' | 'not-found' | 'error',
  message?: string,
): PluginHostResult<never> => ({ error: { code, ...(message ? { message } : {}) } })
const key = (...parts: string[]) => JSON.stringify(parts)
const IMPLEMENTED_HOST_METHODS = [
  'host.describe',
  'host.contributions.register',
  'host.contributions.update',
  'host.contributions.remove',
  'host.settings.open',
  'host.settings.close',
  'host.notifications.show',
  'host.notifications.dismiss',
] as const satisfies readonly (typeof PLUGIN_HOST_METHODS)[number][]

/** One process identity, workspace switch and registry for every contribution kind. */
export class PluginHost {
  private readonly runs = new Map<string, string>()
  private readonly enabled = new Map<string, boolean>()
  private readonly revisions = new Map<string, number>()
  private readonly canonicalRevisions = new Map<string, number>()
  private readonly titles = new Set<string>()
  private readonly titleRevisions = new Map<string, number>()
  private readonly canonicalTitleRevisions = new Map<string, number>()
  private readonly contributions = new Map<string, Contribution>()
  private readonly notifications = new Map<string, Notification>()
  private readonly views = new Map<string, { contribution: Contribution }>()
  private readonly listeners = new Set<(workspaceId: string) => void>()
  constructor(
    private readonly options: {
      callTool(input: PluginHostCall): Promise<PluginToolCallResult>
      cancelTool?(input: {
        workspaceId: string
        pluginId: string
        instanceId: string
        requestId: string
      }): Promise<unknown>
      openSettings?(input: {
        owner: PluginHostOwner
        workspaceId: string
        handle: string
        definition: PluginJsonObject
      }): Promise<string>
      closeSettings?(viewId: string): void | Promise<void>
    },
  ) {}
  attach(owner: PluginHostOwner): void {
    if (this.runs.get(owner.pluginId) === owner.runId) return
    const previous = this.runs.get(owner.pluginId)
    if (previous) this.detach({ pluginId: owner.pluginId, runId: previous })
    this.runs.set(owner.pluginId, owner.runId)
  }
  async registerManifest(
    owner: PluginHostOwner,
    workspaceId: string,
    manifest: AnyPluginManifest,
  ): Promise<void> {
    if (manifest.format !== 3) return
    const declarations: {
      contributionId: string
      kind: string
      api: number
      definition: unknown
    }[] = []
    for (const { id, ...definition } of manifest.ui ?? [])
      declarations.push({ contributionId: id, kind: 'ui.button', api: 1, definition })
    if (manifest.settings)
      declarations.push({
        contributionId: 'settings',
        kind: 'settings.page',
        api: 1,
        definition: {
          title: manifest.name,
          ...manifest.settings.page,
          ...(manifest.settings.fields === undefined ? {} : { fields: manifest.settings.fields }),
        },
      })
    for (const { id, kind, api, invoke } of manifest.hooks ?? [])
      declarations.push({ contributionId: id, kind, api, definition: { invoke } })
    for (const { id, ...definition } of manifest.speech ?? [])
      declarations.push({ contributionId: id, kind: 'speech.transcribe', api: 1, definition })
    for (const { id, ...definition } of manifest.cleanup ?? [])
      declarations.push({ contributionId: id, kind: 'transcript.cleanup', api: 1, definition })
    for (const params of declarations)
      await this.request(owner, {
        api: 1,
        workspaceId,
        requestId: randomUUID(),
        method: 'host.contributions.register',
        params,
      } as PluginHostRequest)
  }
  detach(owner: PluginHostOwner): void {
    if (!this.current(owner)) return
    this.runs.delete(owner.pluginId)
    const workspaces = new Set<string>()
    for (const [handle, item] of this.contributions)
      if (this.same(item.owner, owner)) {
        this.removeContribution(handle)
        workspaces.add(item.workspaceId)
      }
    for (const [handle, item] of this.notifications)
      if (this.same(item.owner, owner)) {
        this.notifications.delete(handle)
        workspaces.add(item.workspaceId)
      }
    for (const workspaceId of workspaces) this.changed(workspaceId)
  }
  detachWorkspace(workspaceId: string): void {
    for (const id of this.enabled.keys()) {
      const [workspace, pluginId] = JSON.parse(id) as [string, string]
      if (workspace === workspaceId) this.setEnabled(workspaceId, pluginId, false)
    }
    for (const [handle, item] of this.contributions)
      if (item.workspaceId === workspaceId) this.removeContribution(handle)
    this.changed(workspaceId)
  }
  setEnabled(
    workspaceId: string,
    pluginId: string,
    enabled: boolean,
    canonicalRevision?: number,
  ): void {
    const id = key(workspaceId, pluginId)
    const previous = this.canonicalRevisions.get(id)
    if (canonicalRevision !== undefined && previous !== undefined && canonicalRevision < previous)
      return
    const changed =
      this.enabled.get(id) !== enabled ||
      (canonicalRevision !== undefined && canonicalRevision !== previous)
    if (!changed) return
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
    if (canonicalRevision !== undefined) this.canonicalRevisions.set(id, canonicalRevision)
    this.enabled.set(id, enabled)
    if (!enabled) {
      for (const [handle, item] of this.notifications)
        if (item.workspaceId === workspaceId && item.pluginId === pluginId)
          this.notifications.delete(handle)
      for (const [viewId, { contribution }] of this.views)
        if (contribution.workspaceId === workspaceId && contribution.pluginId === pluginId)
          this.closeView(viewId)
    }
    this.changed(workspaceId)
  }
  setTitlesEnabled(
    workspaceId: string,
    pluginId: string,
    enabled: boolean,
    canonicalRevision?: number,
  ): void {
    const id = key(workspaceId, pluginId)
    const previous = this.canonicalTitleRevisions.get(id)
    if (canonicalRevision !== undefined && previous !== undefined && canonicalRevision < previous)
      return
    const changed =
      this.titles.has(id) !== enabled ||
      (canonicalRevision !== undefined && canonicalRevision !== previous)
    if (!changed) return
    this.titleRevisions.set(id, (this.titleRevisions.get(id) ?? 0) + 1)
    if (canonicalRevision !== undefined) this.canonicalTitleRevisions.set(id, canonicalRevision)
    if (enabled) this.titles.add(id)
    else this.titles.delete(id)
    this.changed(workspaceId)
  }
  hasTitleHooks(workspaceId: string): boolean {
    return [...this.contributions.values()].some(
      (item) =>
        item.workspaceId === workspaceId &&
        item.kind === 'turn.context.titles' &&
        current(item.pluginId) &&
        this.state(item) === 'active' &&
        this.titles.has(key(workspaceId, item.pluginId)),
    )
  }
  onChanged(listener: (workspaceId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private changed(workspaceId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(workspaceId)
      } catch {
        /* A closed window does not change the registration. */
      }
    }
  }
  private same(a: PluginHostOwner, b: PluginHostOwner): boolean {
    return a.pluginId === b.pluginId && a.runId === b.runId
  }
  private current(owner: PluginHostOwner): boolean {
    return this.runs.get(owner.pluginId) === owner.runId
  }
  private active(owner: PluginHostOwner, workspaceId: string): boolean {
    return this.current(owner) && this.enabled.get(key(workspaceId, owner.pluginId)) === true
  }
  private state(item: Contribution) {
    const supported =
      item.kind === 'settings.page' ||
      item.kind === 'turn.context.titles' ||
      (item.kind === 'ui.button' && item.definition.slot === 'composer.accessory')
    return !supported
      ? ('unsupported' as const)
      : this.active(item.owner, item.workspaceId)
        ? ('active' as const)
        : ('inactive' as const)
  }
  snapshot(workspaceId: string): PluginHostSnapshot {
    return structuredClone({
      contributions: [...this.contributions.values()]
        .filter((item) => item.workspaceId === workspaceId)
        .map((item) => ({
          handle: item.handle,
          pluginId: item.pluginId,
          contributionId: item.contributionId,
          kind: item.kind,
          definition: item.definition,
          state: this.state(item),
          titlesEnabled: this.titles.has(key(workspaceId, item.pluginId)),
        })),
      notifications: [...this.notifications.values()]
        .filter((item) => item.workspaceId === workspaceId && this.active(item.owner, workspaceId))
        .map((item) => ({
          handle: item.handle,
          pluginId: item.pluginId,
          notificationId: item.notificationId,
          title: item.title,
          text: item.text,
          level: item.level,
          actions: item.actions,
        })),
      settingsViews: [...this.views]
        .filter(
          ([, { contribution }]) =>
            contribution.workspaceId === workspaceId &&
            this.active(contribution.owner, workspaceId),
        )
        .map(([viewId, { contribution }]) => ({
          viewId,
          handle: contribution.handle,
          pluginId: contribution.pluginId,
        })),
    })
  }
  private closeView(viewId: string): void {
    const workspaceId = this.views.get(viewId)?.contribution.workspaceId
    this.views.delete(viewId)
    void Promise.resolve()
      .then(() => this.options.closeSettings?.(viewId))
      .catch(() => {})
    if (workspaceId) this.changed(workspaceId)
  }
  private removeContribution(handle: string): void {
    this.contributions.delete(handle)
    for (const [viewId, { contribution }] of this.views)
      if (contribution.handle === handle) this.closeView(viewId)
  }
  private validate(kind: string, definition: PluginJsonObject): void {
    if (kind === 'ui.button') button.parse(definition)
    if (kind === 'settings.page') settings.parse(definition)
    if (kind === 'turn.context.titles') hook.parse(definition)
  }
  async request(
    owner: PluginHostOwner,
    input: PluginHostEnvelope,
    signal?: AbortSignal,
  ): Promise<PluginHostResult<unknown>> {
    if (!this.current(owner) || signal?.aborted) return fail('not-found')
    if (!input || input.api !== 1) return fail('unsupported')
    const workspaceId = input.workspaceId
    if (typeof workspaceId !== 'string' || typeof input.requestId !== 'string')
      return fail('error', 'Invalid host request.')
    try {
      if (input.method === 'host.describe')
        return {
          value: {
            api: 1,
            methods: [...IMPLEMENTED_HOST_METHODS],
            slots: [...PLUGIN_SLOTS],
            hookKinds: ['turn.context.titles'],
            speechAvailable: false,
          },
        }
      if (input.method === 'host.contributions.register') {
        const parsed = registration.parse(input.params)
        if (parsed.api !== 1) return fail('unsupported')
        this.validate(parsed.kind, parsed.definition)
        const old = [...this.contributions.values()].find(
          (item) =>
            this.same(item.owner, owner) &&
            item.workspaceId === workspaceId &&
            item.contributionId === parsed.contributionId,
        )
        if (old) this.removeContribution(old.handle)
        const item: Contribution = {
          ...parsed,
          owner: { ...owner },
          workspaceId,
          pluginId: owner.pluginId,
          handle: randomUUID(),
          state: 'inactive',
          titlesEnabled: false,
        }
        this.contributions.set(item.handle, item)
        this.changed(workspaceId)
        return {
          value: {
            handle: item.handle,
            state: this.state(item),
            ...(item.kind === 'ui.button' ? { viewId: item.handle } : {}),
            ...(item.kind === 'settings.page' ? { pageId: item.handle } : {}),
            ...(['speech.transcribe', 'transcript.cleanup'].includes(item.kind)
              ? { available: false, selected: false }
              : {}),
          },
        }
      }
      if (
        input.method === 'host.contributions.update' ||
        input.method === 'host.contributions.remove'
      ) {
        const { handle } = z.object({ handle: z.string() }).parse(input.params)
        const item = this.contributions.get(handle)
        if (!item || !this.same(item.owner, owner) || item.workspaceId !== workspaceId)
          return fail('not-found')
        if (input.method === 'host.contributions.remove') {
          this.removeContribution(handle)
          this.changed(workspaceId)
          return { value: { removed: true } }
        }
        const { patch } = z.object({ patch: object }).parse(input.params)
        const definition = {
          ...item.definition,
          ...patch,
          ...(patch.view && typeof patch.view === 'object' && !Array.isArray(patch.view)
            ? { view: { ...(item.definition.view as PluginJsonObject), ...patch.view } }
            : {}),
        }
        this.validate(item.kind, definition)
        const updated = { ...item, definition: structuredClone(definition) }
        this.contributions.set(handle, updated)
        for (const [viewId, view] of this.views)
          if (view.contribution === item) this.closeView(viewId)
        this.changed(workspaceId)
        return { value: { definition: updated.definition, state: this.state(updated) } }
      }
      if (
        [
          'host.speech.publish',
          'host.accounts.configure',
          'host.service.request',
          'host.service.read',
          'host.service.cancel',
        ].includes(input.method)
      )
        return fail('unsupported')
      if (!this.active(owner, workspaceId)) return fail('disabled')
      if (input.method === 'host.settings.open') {
        const { contributionId } = z.object({ contributionId: z.string() }).parse(input.params)
        const item = [...this.contributions.values()].find(
          (item) =>
            item.workspaceId === workspaceId &&
            this.same(item.owner, owner) &&
            item.contributionId === contributionId &&
            item.kind === 'settings.page',
        )
        return item ? this.openSettings(workspaceId, item.handle, signal) : fail('not-found')
      }
      if (input.method === 'host.settings.close') {
        const { viewId } = z.object({ viewId: z.string() }).parse(input.params)
        const view = this.views.get(viewId)
        if (
          !view ||
          !this.same(view.contribution.owner, owner) ||
          view.contribution.workspaceId !== workspaceId
        )
          return fail('not-found')
        this.closeView(viewId)
        return { value: { closed: true } }
      }
      if (input.method === 'host.notifications.show') {
        const params = notification.parse(input.params)
        const notificationId = params.notificationId ?? randomUUID()
        const old = [...this.notifications.values()].find(
          (item) =>
            item.workspaceId === workspaceId &&
            this.same(item.owner, owner) &&
            item.notificationId === notificationId,
        )
        if (old) this.notifications.delete(old.handle)
        const item: Notification = {
          ...params,
          actions: (params.actions ?? []).map(({ id, label }) => ({ id, label })),
          notificationId,
          owner: { ...owner },
          pluginId: owner.pluginId,
          workspaceId,
          handle: randomUUID(),
          bindings: new Map((params.actions ?? []).map((action) => [action.id, action.invoke])),
        }
        this.notifications.set(item.handle, item)
        this.changed(workspaceId)
        return { value: { notificationId, shown: true } }
      }
      if (input.method === 'host.notifications.dismiss') {
        const { notificationId } = z.object({ notificationId: z.string() }).parse(input.params)
        const item = [...this.notifications.values()].find(
          (item) =>
            item.workspaceId === workspaceId &&
            this.same(item.owner, owner) &&
            item.notificationId === notificationId,
        )
        if (item) this.notifications.delete(item.handle)
        this.changed(workspaceId)
        return { value: { dismissed: Boolean(item) } }
      }
      return fail('unsupported')
    } catch {
      return fail('error', 'The plugin host operation failed.')
    }
  }
  async openSettings(
    workspaceId: string,
    handle: string,
    signal?: AbortSignal,
  ): Promise<PluginHostResult<unknown>> {
    const item = this.contributions.get(handle)
    if (!item || item.workspaceId !== workspaceId || item.kind !== 'settings.page')
      return fail('not-found')
    if (!this.active(item.owner, workspaceId)) return fail('disabled')
    const revision = this.revisions.get(key(workspaceId, item.pluginId))
    try {
      const viewId = await (this.options.openSettings?.({
        owner: item.owner,
        workspaceId,
        handle,
        definition: structuredClone(item.definition),
      }) ?? Promise.resolve(randomUUID()))
      if (
        signal?.aborted ||
        !this.active(item.owner, workspaceId) ||
        revision !== this.revisions.get(key(workspaceId, item.pluginId)) ||
        this.contributions.get(handle) !== item
      ) {
        this.closeView(viewId)
        return fail(this.current(item.owner) ? 'disabled' : 'not-found')
      }
      this.views.set(viewId, { contribution: item })
      this.changed(workspaceId)
      return { value: { viewId, state: 'active' } }
    } catch {
      return fail('error', 'Could not open plugin settings.')
    }
  }
  closeSettings(workspaceId: string, viewId: string): PluginHostResult<unknown> {
    const view = this.views.get(viewId)
    if (!view || view.contribution.workspaceId !== workspaceId) return fail('not-found')
    this.closeView(viewId)
    return { value: { closed: true } }
  }
  settingsPage(workspaceId: string, viewId: string) {
    const view = this.views.get(viewId)
    if (
      !view ||
      view.contribution.workspaceId !== workspaceId ||
      !this.active(view.contribution.owner, workspaceId) ||
      this.contributions.get(view.contribution.handle) !== view.contribution
    )
      return undefined
    const item = view.contribution
    return {
      pluginId: item.pluginId,
      instanceId: item.owner.runId,
      handle: item.handle,
      page: settings.parse(item.definition),
    }
  }
  private async invoke(
    item: { owner: PluginHostOwner; workspaceId: string; handle: string },
    binding: ToolBinding,
    origin: string,
  ): Promise<PluginHostResult<unknown>> {
    if (!this.active(item.owner, item.workspaceId)) return fail('disabled')
    const revision = this.revisions.get(key(item.workspaceId, item.owner.pluginId))
    try {
      const answer = await pluginToolCallResult(() =>
        this.options.callTool({
          workspaceId: item.workspaceId,
          pluginId: item.owner.pluginId,
          instanceId: item.owner.runId,
          name: binding.tool,
          arguments: structuredClone(binding.arguments ?? {}),
          requestId: randomUUID(),
          origin,
        }),
      )
      if (
        !this.active(item.owner, item.workspaceId) ||
        revision !== this.revisions.get(key(item.workspaceId, item.owner.pluginId))
      )
        return fail('disabled')
      if (
        this.contributions.get(item.handle) !== item &&
        this.notifications.get(item.handle) !== item
      )
        return fail('not-found')
      if (answer.status === 'protocol-error')
        return {
          error: { code: 'protocol-error', message: answer.error.message, protocol: answer.error },
        }
      return answer.status === 'result'
        ? { value: answer.result }
        : answer.status === 'disabled'
          ? fail('disabled')
          : fail('error', answer.message)
    } catch {
      return fail('error', 'The plugin callback failed.')
    }
  }
  activate(workspaceId: string, handle: string): Promise<PluginHostResult<unknown>> {
    const item = this.contributions.get(handle)
    if (!item || item.workspaceId !== workspaceId || item.kind !== 'ui.button')
      return Promise.resolve(fail('not-found'))
    if (this.state(item) !== 'active')
      return Promise.resolve(fail(this.state(item) === 'unsupported' ? 'unsupported' : 'disabled'))
    const definition = button.parse(item.definition)
    if (definition.view.disabled || definition.view.busy) return Promise.resolve(fail('disabled'))
    return this.invoke(item, definition.invoke, 'ui.button')
  }
  notificationAction(
    workspaceId: string,
    handle: string,
    actionId: string,
  ): Promise<PluginHostResult<unknown>> {
    const item = this.notifications.get(handle),
      binding = item?.bindings.get(actionId)
    return item && item.workspaceId === workspaceId && binding
      ? this.invoke(item, binding, 'notification')
      : Promise.resolve(fail('not-found'))
  }
  dismissNotification(workspaceId: string, handle: string): PluginHostResult<unknown> {
    const item = this.notifications.get(handle)
    if (!item || item.workspaceId !== workspaceId) return fail('not-found')
    this.notifications.delete(handle)
    this.changed(workspaceId)
    return { value: { dismissed: true } }
  }
  async beforeTurn(
    input: PluginBeforeTurnInput,
    current: (pluginId: string) => boolean = () => true,
  ): Promise<PluginBeforeTurnResult> {
    const hooks = [...this.contributions.values()].filter(
      (item) =>
        item.workspaceId === input.workspaceId &&
        item.kind === 'turn.context.titles' &&
        this.state(item) === 'active' &&
        this.titles.has(key(input.workspaceId, item.pluginId)),
    )
    if (!hooks.length) return { pointers: [] }
    const candidates = input.candidates
      .filter((item) => item.pieceId === input.pieceId)
      .map(({ resourceId, version, title, pieceId }) => ({ resourceId, version, title, pieceId }))
    const valid = new Set(candidates.map((item) => key(item.resourceId, item.version)))
    const selected: {
      item: Contribution
      revision: number | undefined
      titleRevision: number | undefined
      pointers: PluginBeforeTurnResult['pointers']
    }[] = []
    const pending: { pluginId: string; instanceId: string; requestId: string }[] = []
    let accepting = true
    const work = hooks.map(async (item) => {
      const binding = hook.parse(item.definition).invoke,
        requestId = randomUUID()
      const revision = this.revisions.get(key(input.workspaceId, item.pluginId))
      const titleRevision = this.titleRevisions.get(key(input.workspaceId, item.pluginId))
      const call = { pluginId: item.pluginId, instanceId: item.owner.runId, requestId }
      pending.push(call)
      try {
        if (!current(item.pluginId)) return
        const answer = await this.options.callTool({
          workspaceId: input.workspaceId,
          ...call,
          name: binding.tool,
          arguments: {
            ...structuredClone(binding.arguments ?? {}),
            ...(binding.inputField
              ? {
                  [binding.inputField]: {
                    workspaceId: input.workspaceId,
                    turnId: input.turnId,
                    pieceId: input.pieceId,
                    candidates,
                  },
                }
              : {}),
          },
          origin: 'turn.context.titles',
        })
        if (
          !accepting ||
          !current(item.pluginId) ||
          this.contributions.get(item.handle) !== item ||
          this.state(item) !== 'active'
        )
          return
        if (answer.status !== 'result' || answer.result.isError) return
        let result: unknown = answer.result.structuredContent
        if (!result) {
          const text = answer.result.content.find(
            (block) =>
              block && typeof block === 'object' && !Array.isArray(block) && block.type === 'text',
          ) as { text?: string } | undefined
          if (text?.text) result = JSON.parse(text.text)
        }
        const parsed = z
          .object({ pointers: z.array(z.object({ resourceId: z.string(), version: z.string() })) })
          .safeParse(result)
        if (parsed.success)
          selected.push({
            item,
            revision,
            titleRevision,
            pointers: parsed.data.pointers.filter((pointer) =>
              valid.has(key(pointer.resourceId, pointer.version)),
            ),
          })
      } catch {
        /* A context failure leaves the turn intact. */
      } finally {
        const i = pending.indexOf(call)
        if (i >= 0) pending.splice(i, 1)
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(work),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 500)
        }),
      ])
    } finally {
      accepting = false
      clearTimeout(timer)
      for (const call of pending)
        void this.options.cancelTool?.({ workspaceId: input.workspaceId, ...call }).catch(() => {})
    }
    const pointers = new Map<string, { resourceId: string; version: string }>()
    for (const { item, revision, titleRevision, pointers: chosen } of selected)
      if (
        current(item.pluginId) &&
        this.contributions.get(item.handle) === item &&
        this.state(item) === 'active' &&
        revision === this.revisions.get(key(input.workspaceId, item.pluginId)) &&
        titleRevision === this.titleRevisions.get(key(input.workspaceId, item.pluginId)) &&
        this.titles.has(key(input.workspaceId, item.pluginId))
      )
        for (const pointer of chosen)
          pointers.set(key(pointer.resourceId, pointer.version), pointer)
    return { pointers: [...pointers.values()] }
  }
}
