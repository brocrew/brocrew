<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { loadPluginConfiguration } from '../lib/plugin-configuration-load'
import {
  pluginMutationAllowed,
  pluginDisplayedConsent,
  pluginMutationNotice,
  PluginWindowReviewSchema,
  pluginMutationFailureNotice,
  PLUGIN_DISCLOSURE_WORDS as words,
} from '../../../shared/plugin-settings'
import type {
  PluginCard,
  PluginWindowReview,
  PluginListState,
  PluginListFailureReason,
  PluginsClient,
  PluginSettingsRequest,
  PluginSettingsReply,
} from '../../../shared/plugin-settings'
const props = defineProps<{ client?: PluginsClient }>()
const client = props.client ?? window.api?.plugins
const cards = ref<PluginCard[]>([]),
  query = ref(''),
  error = ref(''),
  removalNotice = ref(''),
  busy = ref(false),
  /** The plugin an install is starting, so the wait reads as progress, not a fault. */
  starting = ref<string | null>(null)
const reviews = ref(new Map<string, PluginWindowReview>())
let stopReviews = () => {}
const selected = ref<PluginCard | null>(null),
  confirmation = ref<PluginCard | null>(null),
  stage = ref<HTMLElement | null>(null),
  configurationState = ref<'loading' | 'ready' | 'error'>('loading')
const shown = computed(() =>
  cards.value.filter((card) => card.name.toLowerCase().includes(query.value.trim().toLowerCase())),
)
let screenId: string | null = null
let configurationAbort: AbortController | undefined
let alive = true,
  generation = 0,
  stop = () => {},
  observer: ResizeObserver | undefined
const listState = ref<PluginListState | null>(null)
const listFailureReason = ref<PluginListFailureReason>()
const refreshFailed = ref(false)
const listMessage = computed(() => {
  switch (listState.value) {
    case 'not-published':
      return 'Plugins will be available with the public release.'
    case 'empty':
      return 'No plugins are available for this version yet.'
    case 'fetch-error':
      if (listFailureReason.value === 'supervisor-unavailable')
        return "Couldn't start the plugin service. Try again."
      return "Couldn't load the plugin catalogue. Try again."
    default:
      return ''
  }
})
const unavailable = 'Plugin unavailable. Try again.'
const failedRetries = ref(new Set<string>())
const cannotStart = (card: PluginCard) => card.state === 'Unavailable' && card.installed !== false
async function retry(card: PluginCard) {
  if (busy.value) return
  busy.value = true
  const answer = await request({ kind: 'retry', id: card.id })
  if (!alive) return
  busy.value = false
  if (answer.ok && answer.cards) cards.value = answer.cards
  const current = cards.value.find((one) => one.id === card.id)
  if (!answer.ok || !current || cannotStart(current)) failedRetries.value.add(card.id)
  else failedRetries.value.delete(card.id)
}
async function request(input: PluginSettingsRequest): Promise<PluginSettingsReply> {
  const failure: PluginSettingsReply =
    input.kind === 'list'
      ? { ok: false, listState: 'fetch-error' }
      : { ok: false, error: unavailable }
  try {
    return (await client?.request(input)) ?? failure
  } catch {
    return failure
  }
}
/**
 * The part of the stage inside the window. A window narrower than the app's frame scrolls the frame
 * sideways, so the stage can run past either edge; the plugin's screen covers only what is seen.
 */
function bounds() {
  const box = stage.value?.getBoundingClientRect()
  if (!box) return null
  const x = Math.round(box.x),
    y = Math.round(box.y),
    { clientWidth, clientHeight } = document.documentElement
  const left = Math.max(0, x),
    top = Math.max(0, y)
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.min(x + Math.floor(box.width), clientWidth) - left),
    height: Math.max(0, Math.min(y + Math.floor(box.height), clientHeight) - top),
  }
}
function configurationFailed() {
  configurationAbort?.abort()
  screenId = null
  busy.value = false
  configurationState.value = 'error'
  observer?.disconnect()
  void request({ kind: 'close' })
}
async function move() {
  const turn = generation,
    box = bounds()
  if (selected.value && configurationState.value === 'ready' && box) {
    const answer = await request({ kind: 'bounds', bounds: box })
    if (alive && turn === generation && !answer.ok) {
      configurationFailed()
    }
  }
}
async function cancel() {
  reviews.value.clear()
  generation++
  configurationAbort?.abort()
  error.value = ''
  screenId = null
  selected.value = null
  busy.value = false
  observer?.disconnect()
  await request({ kind: 'close' })
}
async function configure(card: PluginCard) {
  if (busy.value) return
  reviews.value.clear()
  const turn = ++generation
  configurationAbort?.abort()
  const abort = new AbortController()
  configurationAbort = abort
  observer?.disconnect()
  configurationState.value = 'loading'
  error.value = ''
  busy.value = true
  selected.value = card
  const ownScreen = crypto.randomUUID()
  screenId = ownScreen
  await nextTick()
  if (!alive || turn !== generation) return
  const box = bounds()
  const answer = box
    ? await loadPluginConfiguration(
        () => request({ kind: 'configure', id: card.id, screenId: ownScreen, bounds: box }),
        abort.signal,
      )
    : { ok: false }
  if (!alive || turn !== generation) return
  busy.value = false
  if (!answer.ok) {
    configurationFailed()
    return
  }
  configurationState.value = 'ready'
  observer = new ResizeObserver(() => {
    void move()
  })
  if (stage.value) observer.observe(stage.value)
}
async function preview(action: 'install' | 'update', card: PluginCard) {
  if (busy.value || card.mutationBlocked) return
  const turn = ++generation
  busy.value = true
  error.value = ''
  reviews.value.clear()
  const answer = await request({ kind: 'prepare', action, id: card.id })
  if (!alive || turn !== generation) return
  busy.value = false
  const parsed = answer.ok ? PluginWindowReviewSchema.safeParse(answer.review) : null
  if (parsed?.success && parsed.data.id === card.id && parsed.data.action === action)
    reviews.value.set(card.id, parsed.data)
  else
    error.value =
      !answer.ok && 'mutationFailure' in answer && answer.mutationFailure
        ? pluginMutationFailureNotice(answer.mutationFailure)
        : unavailable
}
async function cancelReview() {
  reviews.value.clear()
  await request({ kind: 'close' })
}
async function change(kind: 'install' | 'update' | 'uninstall', card: PluginCard) {
  const shown = reviews.value.get(card.id)
  const guarded = kind !== 'uninstall' && card.preparationRequired === true
  if (
    busy.value ||
    (kind !== 'uninstall' &&
      (card.preparationRequired || card.mutationBlocked) &&
      !pluginMutationAllowed(card, kind, shown))
  )
    return
  busy.value = true
  error.value = ''
  confirmation.value = null
  reviews.value.clear()
  generation++
  screenId = null
  selected.value = null
  observer?.disconnect()
  // Main closes the existing screen while preserving only this validated review.
  if (!guarded) await request({ kind: 'close' })
  if (kind === 'install') starting.value = card.id
  const input: PluginSettingsRequest =
    kind === 'uninstall'
      ? { kind, id: card.id }
      : {
          kind,
          id: card.id,
          ...(guarded && shown ? { consent: pluginDisplayedConsent(shown) } : {}),
        }
  const answer = await request(input)
  if (!alive) return
  starting.value = null
  busy.value = false
  if (answer.ok && answer.cards) {
    cards.value = answer.cards
    if (kind === 'uninstall' && answer.removal) {
      removalNotice.value =
        answer.removal.logout === 'confirmed'
          ? `${card.name}'s local data was deleted and its device was logged out.`
          : `${card.name}'s local data was deleted. Logout was not confirmed. Open Linked devices on your phone and remove this device if it is still listed.`
    }
  } else {
    error.value =
      guarded && !answer.ok && 'mutationFailure' in answer && answer.mutationFailure
        ? pluginMutationFailureNotice(answer.mutationFailure)
        : unavailable
    if (guarded) {
      const listed = await request({ kind: 'list' })
      if (alive && listed.ok && listed.cards) cards.value = listed.cards
    }
  }
}
onMounted(async () => {
  stopReviews =
    client?.onReviewInvalidated?.(() => {
      reviews.value.clear()
    }) ?? (() => {})
  stop =
    client?.onClosed((closedScreen) => {
      if (selected.value && closedScreen === screenId) {
        generation++
        configurationFailed()
      }
    }) ?? (() => {})
  window.addEventListener('resize', move)
  window.addEventListener('scroll', move, true)
  const answer = await request({ kind: 'list' })
  if (!alive) return
  if (answer.ok && answer.cards) {
    cards.value = answer.cards
    refreshFailed.value = answer.refreshFailed === true
    listState.value = answer.listState ?? (answer.cards.length ? 'ready' : 'empty')
  } else {
    listState.value = 'listState' in answer ? (answer.listState ?? 'fetch-error') : 'fetch-error'
    listFailureReason.value = 'reason' in answer ? answer.reason : undefined
  }
})
onUnmounted(() => {
  alive = false
  generation++
  configurationAbort?.abort()
  stop()
  stopReviews()
  reviews.value.clear()
  observer?.disconnect()
  window.removeEventListener('resize', move)
  window.removeEventListener('scroll', move, true)
  void request({ kind: 'close' })
})
</script>
<template>
  <section class="plugins-section" :class="{ configuring: selected }" data-cy="plugins-section">
    <p v-if="!selected" class="plugin-trust">
      Plugins run with your computer user’s rights; they are not sandboxed.
    </p>
    <p v-if="!selected" class="plugin-trust">This change applies to all workspaces.</p>
    <label v-if="!selected" class="plugin-search"
      ><span>Search plugins</span
      ><input
        v-model="query"
        type="search"
        maxlength="128"
        placeholder="Search plugins"
        data-cy="plugins-search"
    /></label>
    <p v-if="listMessage" role="status" class="plugin-error" data-cy="plugins-list-status">
      {{ listMessage }}
    </p>
    <p
      v-if="refreshFailed && !selected"
      role="status"
      class="plugin-trust"
      data-cy="plugins-refresh-notice"
    >
      Couldn't check for plugin updates. Check your connection and try again.
    </p>
    <p v-if="error" role="status" class="plugin-error" data-cy="plugins-error">{{ error }}</p>
    <p v-if="removalNotice" role="status" class="plugin-trust" data-cy="plugins-removal-notice">
      {{ removalNotice }}
    </p>
    <div v-if="selected" class="plugin-configuration" data-cy="plugin-configuration">
      <header>
        <h2>{{ selected.name }}</h2>
        <button class="bb-button" type="button" data-cy="plugin-close" @click="cancel">
          Cancel
        </button>
      </header>
      <p>This change applies to all workspaces.</p>
      <div
        ref="stage"
        class="plugin-stage"
        data-cy="plugin-stage"
        :aria-busy="configurationState === 'loading'"
      >
        <div v-if="configurationState !== 'ready'" class="plugin-configuration-message">
          <p v-if="configurationState === 'loading'" role="status" data-cy="plugin-loading">
            Loading…
          </p>
          <template v-else>
            <p role="alert" data-cy="plugins-error">{{ unavailable }}</p>
            <button
              class="bb-button"
              type="button"
              data-cy="plugin-configuration-retry"
              @click="configure(selected)"
            >
              Try again
            </button>
          </template>
        </div>
      </div>
    </div>
    <div v-else class="plugin-cards">
      <article
        v-for="card in shown"
        :key="card.id"
        class="plugin-card"
        :data-plugin="card.id"
        data-cy="plugin-card"
      >
        <div class="plugin-card-copy">
          <h2>{{ card.name }}</h2>
          <span class="plugin-state" data-cy="plugin-state">{{ card.state }}</span>
          <p v-if="card.installed">Installed for all workspaces.</p>
          <p v-if="card.updatesUnavailable" role="status" data-cy="plugin-updates-unavailable">
            Updates aren’t available for this version of BroCrew.
          </p>
          <p v-if="starting === card.id" role="status" data-cy="plugin-starting">
            Installing and starting {{ card.name }}. The first start can take a minute.
          </p>
          <p
            v-if="cannotStart(card)"
            class="plugin-trust"
            role="status"
            data-cy="plugin-start-error"
          >
            {{ card.name }} can't start right now.
            <span v-if="failedRetries.has(card.id)" data-cy="plugin-restart-hint"
              >Restart BroCrew if this keeps happening.</span
            >
          </p>
        </div>
        <div
          v-if="reviews.get(card.id)"
          class="plugin-confirmation plugin-disclosure"
          data-cy="plugin-review-details"
        >
          <template v-for="review in [reviews.get(card.id)!]" :key="review.consent.reviewId">
            <h3>{{ words.details }}</h3>
            <p>{{ words.beforeChange }}</p>
            <p>
              <strong>{{ words.version }}</strong>
              <bdi dir="auto">{{ review.details.version }}</bdi>
            </p>
            <p>
              <strong>{{ words.authors }}</strong>
              <bdi dir="auto">{{ review.details.authors?.join(', ') }}</bdi>
            </p>
            <h4>{{ words.permissions }}</h4>
            <p>
              <bdi dir="auto">{{ review.details.permissions.description }}</bdi>
            </p>
            <ul>
              <li v-for="resource in review.details.permissions.resources" :key="resource.id">
                <bdi dir="auto">{{ resource.label }}</bdi
                >: <span v-if="resource.read">{{ words.read }}</span
                ><span v-if="resource.read && resource.write">, </span
                ><span v-if="resource.write">Write</span
                ><span v-if="!resource.read && !resource.write">{{ words.noAccess }}</span>
              </li>
            </ul>
            <template v-if="review.action === 'update'">
              <h4>{{ words.changes }}</h4>
              <p v-if="!review.installed">
                {{ words.unknownInstalled }}
              </p>
              <p>{{ review.changes.authors ? words.authorsChanged : words.authorsUnchanged }}</p>
              <p>
                {{
                  review.changes.permissions ? words.permissionsChanged : words.permissionsUnchanged
                }}
              </p>
            </template>
            <div class="plugin-actions">
              <button
                class="bb-button bb-button--primary"
                type="button"
                :disabled="busy || !pluginMutationAllowed(card, review.action, review)"
                data-cy="plugin-review-confirm"
                @click="change(review.action, card)"
              >
                {{
                  review.action === 'install' ? 'Install' : `Update to ${review.details.version}`
                }}
              </button>
              <button
                class="bb-button"
                type="button"
                :disabled="busy"
                data-cy="plugin-review-cancel"
                @click="cancelReview"
              >
                {{ words.cancel }}
              </button>
            </div>
          </template>
        </div>
        <div class="plugin-actions">
          <button
            v-if="cannotStart(card)"
            :disabled="busy"
            type="button"
            class="bb-button bb-button--primary"
            data-cy="plugin-retry"
            @click="retry(card)"
          >
            Try again
          </button>
          <button
            v-else-if="
              card.installed === false &&
              card.preparationRequired &&
              !card.mutationBlocked &&
              !reviews.has(card.id)
            "
            :disabled="busy || card.state === 'Unavailable'"
            type="button"
            class="bb-button bb-button--primary"
            data-cy="plugin-review-install"
            @click="preview('install', card)"
          >
            {{ words.reviewInstall }}
          </button>
          <button
            v-else-if="card.installed === false && !reviews.has(card.id)"
            :disabled="
              busy ||
              card.state === 'Unavailable' ||
              !!card.preparationRequired ||
              !!card.mutationBlocked
            "
            type="button"
            class="bb-button bb-button--primary"
            data-cy="plugin-install"
            @click="change('install', card)"
          >
            Install
          </button>
          <template v-else-if="card.installed"
            ><button
              :disabled="busy || card.state === 'Unavailable'"
              type="button"
              class="bb-button bb-button--primary"
              data-cy="plugin-configure"
              @click="configure(card)"
            >
              Configure</button
            ><button
              v-if="
                card.updateVersion &&
                card.preparationRequired &&
                !card.mutationBlocked &&
                !reviews.has(card.id)
              "
              class="bb-button"
              :disabled="busy || card.state === 'Unavailable'"
              type="button"
              data-cy="plugin-review-update"
              @click="preview('update', card)"
            >
              {{ words.reviewUpdate }}</button
            ><button
              v-if="
                card.updateVersion &&
                !reviews.has(card.id) &&
                (!card.preparationRequired || card.mutationBlocked)
              "
              class="bb-button"
              :disabled="
                busy ||
                card.state === 'Unavailable' ||
                !!card.preparationRequired ||
                !!card.mutationBlocked
              "
              type="button"
              data-cy="plugin-update"
              @click="change('update', card)"
            >
              Update to {{ card.updateVersion }}</button
            ><button
              class="bb-button"
              :disabled="busy"
              type="button"
              data-cy="plugin-uninstall"
              @click="confirmation = card"
            >
              Uninstall
            </button></template
          >
        </div>
        <p v-if="card.mutationBlocked" class="plugin-trust" role="status">
          {{ pluginMutationNotice(card.mutationBlocked) }}
        </p>
        <div
          v-if="confirmation?.id === card.id"
          class="plugin-confirmation"
          role="alertdialog"
          :aria-label="`Uninstall ${card.name}`"
          data-cy="plugin-confirmation"
        >
          <p v-if="card.uninstallDeletesData">
            Uninstall {{ card.name }} from all workspaces and delete its local data.
          </p>
          <p v-else>Uninstall {{ card.name }} from all workspaces. Its data will be kept.</p>
          <p v-if="card.hasRemoteLogout">
            If logout cannot be confirmed, you will need to remove the linked device on your phone.
          </p>
          <button
            class="bb-button"
            type="button"
            @click="change('uninstall', card)"
            data-cy="plugin-uninstall-confirm"
          >
            Uninstall</button
          ><button class="bb-button" type="button" @click="confirmation = null">Cancel</button>
        </div>
      </article>
    </div>
  </section>
</template>
<style scoped>
.plugins-section {
  color: var(--text);
  min-width: 0;
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.plugin-trust {
  margin: 0;
  max-width: 62ch;
  line-height: 1.6;
}
.plugin-search {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: var(--fw-bold);
}
.plugin-search input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 12px 14px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
}
.plugin-cards {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.plugin-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 22px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
}
h2 {
  margin: 0;
  font-size: var(--type-heading);
  font-weight: var(--fw-bold);
}
.plugin-card-copy {
  flex: 1;
  min-width: 180px;
}
.plugin-state {
  display: inline-block;
  margin-top: 10px;
  font-weight: var(--fw-bold);
}
.plugin-card p,
.plugin-configuration p {
  margin: 10px 0 0;
  line-height: 1.5;
}
.plugin-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
.plugin-confirmation {
  flex-basis: 100%;
  border-top: var(--border-width) solid var(--line);
  padding-top: 14px;
}
.plugin-confirmation button {
  margin: 12px 10px 0 0;
}
.plugins-section.configuring {
  flex: 1;
  min-height: 0;
  max-width: none;
}
.plugin-configuration {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.plugin-configuration header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.plugin-stage {
  margin-top: 16px;
  width: 100%;
  flex: 1;
  /* The main process opens no plugin screen shorter than this (settings.ts). */
  min-height: 150px;
  box-sizing: border-box;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--panel);
}
.plugin-error {
  margin: 0;
  color: var(--text);
  font-weight: var(--fw-bold);
}

.plugin-configuration-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 150px;
  height: 100%;
  gap: 16px;
  padding: 24px;
  box-sizing: border-box;
}
.plugin-configuration-message p {
  margin: 0;
}
</style>
