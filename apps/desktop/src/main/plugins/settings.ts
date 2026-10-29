import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { PluginSupervisorError } from './supervisor/protocol'
import { displayedDetailsHash } from './mutation-disclosure'
import { PluginListError } from './catalogue/list-error'
import {
  openPluginConfigurationView,
  type PluginConfigurationView,
  type PluginUiHostOptions,
} from './ui/host'
import { exact, plain, boundedJson, PLUGIN_UI_UNAVAILABLE } from '../../shared/plugin-ui'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PLUGIN_SCREEN_CLOSED,
  PLUGIN_STATES,
  pluginMutationAllowed,
  PluginMutationReviewSchema,
  PluginDisplayedConsentSchema,
  PLUGIN_REVIEW_INVALIDATED,
  type PluginMutationReview,
  type PluginMutationFailure,
  type PluginMutationConsent,
  type PluginMutationBlocked,
  pluginRemovalOutcome,
  type PluginRemovalOutcome,
  type PluginCard,
  type PluginScreenBounds,
  type PluginSettingsReply,
} from '../../shared/plugin-settings'
/** Person-owned install/uninstall controller. Tests inject explicitly fictional fakes. */
export interface PluginSettingsController {
  features?(): readonly string[]
  mutationStatus?(): PluginMutationBlocked | null
  mutationRequired?(): boolean
  prepareMutation?(action: 'install' | 'update', id: string): Promise<PluginMutationConsent>
  reviewMutation?(action: 'install' | 'update', id: string): Promise<PluginMutationReview>
  cancelPreparations?(): void
  onReviewInvalidated?(listener: () => void): () => void
  available?(): boolean
  ready?(): Promise<boolean>
  catalogue(refresh?: boolean): Promise<PluginCard[]>
  refreshFailed?(): boolean
  refreshCatalogue?(
    digest: string,
    source?: { bytes: Uint8Array; signature: Uint8Array },
  ): Promise<void>
  update?(id: string, consent?: PluginMutationConsent): Promise<void>
  /** Reattach person control only; no install or removal. */
  retry?(id: string): Promise<PluginCard[]>
  install(id: string, consent?: PluginMutationConsent): Promise<void>
  uninstall(id: string): Promise<PluginRemovalOutcome | void>
  screen(id: string): Promise<PluginUiHostOptions>
}
/** A refusal's step and error code as closed words, never its message, which may name a path. */
function errorCode(error: unknown): string {
  const { step, code, name } = (error ?? {}) as { step?: unknown; code?: unknown; name?: unknown }
  const word = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
  return [step, code].filter(word).join(' ') || (word(name) ? String(name) : 'other')
}
export function registerPluginSettings(
  ipc: Pick<IpcMain, 'handle'>,
  ownerOf: (event: IpcMainInvokeEvent) => BrowserWindow | null,
  controller?: PluginSettingsController,
): void {
  const windows = new WeakMap<
    BrowserWindow,
    {
      generation: number
      screen?: PluginConfigurationView
      reviews: Map<string, { reviewId: string; review: PluginMutationReview }>
    }
  >()
  const liveWindows = new Set<BrowserWindow>()
  controller?.onReviewInvalidated?.(() => {
    for (const owner of liveWindows) {
      const state = windows.get(owner)
      if (state?.reviews.size) {
        state.reviews.clear()
        if (!owner.isDestroyed()) owner.webContents.send(PLUGIN_REVIEW_INVALIDATED)
      }
    }
  })
  async function close(owner: BrowserWindow, preservingReview = false) {
    const state = windows.get(owner)
    if (!state) return 0
    const generation = ++state.generation
    if (!preservingReview) {
      state.reviews.clear()
      controller?.cancelPreparations?.()
    }
    const previous = state.screen
    await previous?.close()
    if (state.screen === previous) state.screen = undefined
    return generation
  }
  /**
   * The part of the asked rectangle inside the window's content, or null when that part is
   * smaller than a plugin screen may be. The window can shrink between a measure and its arrival.
   */
  function rectangle(value: unknown, owner: BrowserWindow): PluginScreenBounds | null {
    if (!plain(value) || !exact(value, ['x', 'y', 'width', 'height'])) return null
    const { x, y, width, height } = value
    if (
      ![x, y, width, height].every(Number.isSafeInteger) ||
      Number(width) < 0 ||
      Number(height) < 0
    )
      return null
    const content = owner.getContentBounds()
    const left = Math.max(0, Number(x)),
      top = Math.max(0, Number(y))
    const shown = {
      x: left,
      y: top,
      width: Math.min(content.width, Number(x) + Number(width)) - left,
      height: Math.min(content.height, Number(y) + Number(height)) - top,
    }
    return shown.width >= 200 && shown.height >= 150 ? shown : null
  }
  /** Why a plugin screen was not opened, with the asked and the window's sizes as numbers. */
  function screenRefused(why: string, value: unknown, owner: BrowserWindow): void {
    const asked = plain(value)
      ? (['x', 'y', 'width', 'height'] as const)
          .map((key) => (Number.isFinite(Number(value[key])) ? Number(value[key]) : 'none'))
          .join(' ')
      : 'none'
    const content = owner.isDestroyed() ? null : owner.getContentBounds()
    console.warn(
      `[plugins] plugin-screen-refused ${why} asked ${asked} window ${content ? `${content.width} ${content.height}` : 'none'}`,
    )
  }
  async function catalogue(load = () => controller!.catalogue()): Promise<PluginCard[]> {
    const cards = await load()
    if (
      !Array.isArray(cards) ||
      cards.length > 200 ||
      boundedJson(cards, 256 * 1024) === null ||
      new Set(cards.map((card) => card.id)).size !== cards.length ||
      !cards.every(
        (card) =>
          plain(card) &&
          ['id', 'name', 'state', 'installed'].every((key) => Object.hasOwn(card, key)) &&
          Object.keys(card).every((key) =>
            [
              'id',
              'name',
              'state',
              'installed',
              'priorityClamped',
              'installedVersion',
              'updateVersion',
              'updatesUnavailable',
              'uninstallDeletesData',
              'hasRemoteLogout',
              'preparationRequired',
              'mutationBlocked',
            ].includes(key),
          ) &&
          (card.priorityClamped === undefined ||
            typeof card.priorityClamped === 'boolean' ||
            card.priorityClamped === null) &&
          [card.installedVersion, card.updateVersion].every(
            (version) =>
              version === undefined ||
              (typeof version === 'string' &&
                version.length > 0 &&
                version.length <= 80 &&
                !/[\r\n\0]/.test(version)),
          ) &&
          (card.updatesUnavailable === undefined ||
            (card.updatesUnavailable === true &&
              card.installed === true &&
              card.updateVersion === undefined)) &&
          (card.updateVersion === undefined ||
            (card.installed === true && card.installedVersion !== undefined)) &&
          (card.uninstallDeletesData === undefined ||
            typeof card.uninstallDeletesData === 'boolean') &&
          (card.hasRemoteLogout === undefined || typeof card.hasRemoteLogout === 'boolean') &&
          (card.preparationRequired === undefined || card.preparationRequired === true) &&
          (card.mutationBlocked === undefined ||
            ['source-mismatch', 'owner-incompatible'].includes(card.mutationBlocked)) &&
          /^[a-z][a-z0-9-]{0,63}$/.test(card.id) &&
          typeof card.name === 'string' &&
          card.name.length > 0 &&
          card.name.length <= 128 &&
          (typeof card.installed === 'boolean' || card.installed === null) &&
          PLUGIN_STATES.includes(card.state) &&
          (card.state === 'Unavailable' || card.installed === (card.state !== 'Available')),
      )
    )
      throw new Error(PLUGIN_UI_UNAVAILABLE)
    return cards.map((card) => ({ ...card }))
  }
  ipc.handle(
    PLUGIN_SETTINGS_CHANNEL,
    async (event, input: unknown, ...extra): Promise<PluginSettingsReply> => {
      const refused: PluginSettingsReply = { ok: false, error: PLUGIN_UI_UNAVAILABLE }
      const owner = ownerOf(event)
      if (
        !owner ||
        owner.isDestroyed() ||
        owner.webContents !== event.sender ||
        event.senderFrame !== event.sender.mainFrame ||
        extra.length ||
        !plain(input)
      )
        return refused
      if (!windows.has(owner)) {
        windows.set(owner, { generation: 0, reviews: new Map() })
        liveWindows.add(owner)
        owner.once('closed', () => {
          liveWindows.delete(owner)
          void close(owner).catch(() => {})
        })
        owner.webContents.on('destroyed', () => {
          void close(owner).catch(() => {})
        })
        owner.webContents.on('render-process-gone', () => {
          void close(owner).catch(() => {})
        })
        owner.webContents.on('did-navigate', () => {
          void close(owner).catch(() => {})
        })
      }
      const state = windows.get(owner)!
      let created: PluginConfigurationView | undefined
      let mutationContext = false
      try {
        if (input.kind === 'close' && exact(input, ['kind'])) {
          await close(owner)
          return { ok: true }
        }
        if (input.kind === 'bounds' && exact(input, ['kind', 'bounds']) && state.screen) {
          const shown = rectangle(input.bounds, owner)
          if (!shown) return refused
          state.screen.view.setBounds(shown)
          return { ok: true }
        }
        if (input.kind === 'availability' && exact(input, ['kind']))
          return {
            ok: true,
            available: controller?.ready
              ? await controller.ready()
              : Boolean(controller && (controller.available?.() ?? true)),
          }
        if (input.kind === 'list' && exact(input, ['kind'])) {
          state.reviews.clear()
          controller?.cancelPreparations?.()
          if (!controller || !(controller.available?.() ?? true))
            return { ok: false, listState: 'fetch-error' }
          try {
            const cards = await catalogue(() => controller.catalogue(true))
            return {
              ok: true,
              cards,
              listState: cards.length ? 'ready' : 'empty',
              ...(controller.refreshFailed?.() ? { refreshFailed: true } : {}),
            }
          } catch (error) {
            return {
              ok: false,
              listState: error instanceof PluginListError ? error.state : 'fetch-error',
              ...(error instanceof PluginListError && error.reason ? { reason: error.reason } : {}),
            }
          }
        }
        if (!controller || !(controller.available?.() ?? true)) return refused
        if (
          !['install', 'update', 'uninstall', 'configure', 'retry', 'prepare'].includes(
            String(input.kind),
          ) ||
          typeof input.id !== 'string' ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)
        )
          return refused
        if (
          !exact(
            input,
            input.kind === 'configure'
              ? ['kind', 'id', 'screenId', 'bounds']
              : input.kind === 'prepare'
                ? ['kind', 'id', 'action']
                : Object.hasOwn(input, 'consent') &&
                    ['install', 'update'].includes(String(input.kind))
                  ? ['kind', 'id', 'consent']
                  : ['kind', 'id'],
          )
        )
          return refused
        if (input.kind === 'configure') {
          if (state.reviews.size) await close(owner)
          if (!rectangle(input.bounds, owner)) {
            screenRefused('bounds', input.bounds, owner)
            return refused
          }
          if (typeof input.screenId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.screenId))
            return refused
        }
        if (input.kind === 'retry') {
          state.reviews.clear()
          controller.cancelPreparations?.()
          // Same catalogue/connect path as list; never an install/uninstall or new authority.
          const id = input.id
          const cards = await catalogue(() =>
            controller.retry ? controller.retry(id) : controller.catalogue(),
          )
          return cards.some((card) => card.id === id) ? { ok: true, cards } : refused
        }
        if (input.kind === 'uninstall') {
          let removing: Promise<PluginRemovalOutcome | void>
          try {
            removing = controller.uninstall(input.id)
          } catch {
            removing = Promise.reject(new Error(PLUGIN_UI_UNAVAILABLE))
          }
          const closing = close(owner) // Invalidates the generation synchronously; neither failure skips the other.
          const result = await Promise.allSettled([removing, closing])
          if (result.some((one) => one.status !== 'fulfilled')) return refused
          const removed = result[0]
          if (!removed || removed.status !== 'fulfilled') return refused
          const removal =
            removed.value === undefined ? undefined : pluginRemovalOutcome(removed.value)
          if (removal === null) return refused
          return { ok: true, cards: await catalogue(), ...(removal ? { removal } : {}) }
        }
        const admittedGeneration = state.generation
        const card = (await catalogue()).find((card) => card.id === input.id)
        if (!card) return refused
        mutationContext =
          card.preparationRequired === true &&
          ['prepare', 'install', 'update'].includes(String(input.kind))
        if (input.kind === 'prepare') {
          if (!mutationContext || !['install', 'update'].includes(String(input.action)))
            return refused
          if (card.mutationBlocked)
            throw new PluginSupervisorError(
              card.mutationBlocked === 'source-mismatch' ? 'source-mismatch' : 'incompatible',
            )
          const action = input.action as 'install' | 'update'
          if (
            !controller.reviewMutation ||
            !pluginMutationAllowed({ ...card, preparationRequired: undefined }, action)
          )
            throw new PluginSupervisorError('policy-refused')
          const generation = await close(owner)
          const parsed = PluginMutationReviewSchema.safeParse(
            await controller.reviewMutation(action, card.id),
          )
          if (!parsed.success || generation !== state.generation || owner.isDestroyed()) {
            controller.cancelPreparations?.()
            throw new PluginSupervisorError('policy-refused')
          }
          const { consent, ...display } = parsed.data
          if (
            parsed.data.id !== card.id ||
            parsed.data.action !== action ||
            boundedJson(parsed.data, 64 * 1024) === null ||
            displayedDetailsHash(display) !== consent.displayedDetailsHash
          ) {
            controller.cancelPreparations?.()
            throw new PluginSupervisorError('policy-refused')
          }
          const reviewId = randomUUID()
          state.reviews.set(card.id, { reviewId, review: parsed.data })
          return {
            ok: true,
            review: {
              ...display,
              consent: {
                reviewId,
                displayedDetailsHash: consent.displayedDetailsHash,
              },
            },
          }
        }
        if (input.kind === 'install' || input.kind === 'update') {
          if (mutationContext) {
            const held = state.reviews.get(card.id)
            state.reviews.delete(card.id)
            if (card.mutationBlocked)
              throw new PluginSupervisorError(
                card.mutationBlocked === 'source-mismatch' ? 'source-mismatch' : 'incompatible',
              )
            const parsed = PluginDisplayedConsentSchema.safeParse(input.consent)
            if (
              !held ||
              !parsed.success ||
              held.review.action !== input.kind ||
              held.reviewId !== parsed.data.reviewId ||
              held.review.consent.displayedDetailsHash !== parsed.data.displayedDetailsHash ||
              displayedDetailsHash(
                (({ consent, ...display }) => {
                  void consent
                  return display
                })(held.review),
              ) !== parsed.data.displayedDetailsHash ||
              !pluginMutationAllowed(card, input.kind, held.review)
            ) {
              if (held) controller.cancelPreparations?.()
              throw new PluginSupervisorError('policy-refused')
            }
            await close(owner, true)
            if (owner.isDestroyed()) throw new PluginSupervisorError('policy-refused')
            if (input.kind === 'update') {
              if (!controller.update) throw new PluginSupervisorError('incompatible')
              await controller.update(card.id, held.review.consent)
            } else await controller.install(card.id, held.review.consent)
            return { ok: true, cards: await catalogue() }
          }
          if (Object.hasOwn(input, 'consent')) return refused
        }
        if (
          input.kind === 'configure' &&
          (admittedGeneration !== state.generation || owner.isDestroyed())
        )
          return refused
        if (input.kind === 'install') {
          if (!pluginMutationAllowed(card, 'install')) return refused
          await controller.install(card.id)
        } else if (input.kind === 'update') {
          if (!pluginMutationAllowed(card, 'update') || !controller.update) return refused
          await close(owner)
          await controller.update(card.id)
        } else {
          if (!card.installed || card.state === 'Unavailable') {
            screenRefused(`card-${card.state.toLowerCase()}`, input.bounds, owner)
            return refused
          }
          const generation = await close(owner)
          if (generation !== state.generation) return refused
          let source: PluginUiHostOptions
          try {
            source = await controller.screen(card.id)
          } catch (error) {
            screenRefused(`source ${errorCode(error)}`, input.bounds, owner)
            throw error
          }
          if (
            generation !== state.generation ||
            owner.isDestroyed() ||
            source.binding.pluginId !== card.id
          )
            return refused
          const ownership: { screen?: PluginConfigurationView } = {}
          const screen = await openPluginConfigurationView({
            ...source,
            current: (binding) =>
              generation === state.generation && !owner.isDestroyed() && source.current(binding),
            detached: () => {
              if (ownership.screen && !owner.isDestroyed())
                owner.contentView.removeChildView(ownership.screen.view)
              source.detached?.()
            },
          }).catch((error: unknown) => {
            screenRefused(`view ${errorCode(error)}`, input.bounds, owner)
            throw error
          })
          ownership.screen = screen
          created = screen
          if (generation !== state.generation || owner.isDestroyed()) {
            await screen.close()
            return refused
          }
          state.screen = screen
          const shown = rectangle(input.bounds, owner)
          if (!shown) {
            screenRefused('bounds-after-open', input.bounds, owner)
            await screen.close()
            return refused
          }
          screen.view.setBounds(shown)
          owner.contentView.addChildView(screen.view)
          screen.view.webContents.once('destroyed', () => {
            if (state.screen === screen) {
              state.screen = undefined
              if (!owner.isDestroyed()) owner.webContents.send(PLUGIN_SCREEN_CLOSED, input.screenId)
            }
          })
          return { ok: true }
        }
        return { ok: true, cards: await catalogue() }
      } catch (error) {
        await created?.close().catch(() => {})
        if (mutationContext) {
          const code = error instanceof PluginSupervisorError ? error.code : 'unavailable'
          const mutationFailure: PluginMutationFailure =
            code === 'incompatible'
              ? 'owner-incompatible'
              : ['policy-refused', 'source-mismatch', 'network'].includes(code)
                ? (code as PluginMutationFailure)
                : 'unavailable'
          return { ...refused, mutationFailure }
        }
        return refused
      }
    },
  )
}
