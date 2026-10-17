<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, useId } from 'vue'
import type {
  ThemeReading,
  ThemeRefused,
  ThemeRow,
  ThemeSnapshot,
  ThemesBridge,
} from '../../../shared/theme-library'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { useOverlays } from '../lib/overlay-store'
import { readableError } from '../lib/session-record'
import { previewCss } from '../lib/theme-previews'
import { THEME_WORDS } from '../lib/theme-words'
import { onThemesChanged } from '../lib/window-theme'

/**
 * The workspace's theme: every theme this app can use, each on a card with a small preview of the
 * window in it. Use switches the window at once; Duplicate makes an editable copy; Delete moves a
 * theme of one's own to the Trash. Read when the section opens and again on every change the host
 * announces, whoever made it, as the window's theme follower passes it on.
 *
 * Each mounted section owns its previews' stylesheet, and once it is unmounted no answer that
 * arrives late touches its state, its stylesheet or starts another read.
 */
const props = defineProps<{ themes?: ThemesBridge }>()
const bridge = (): ThemesBridge | undefined => props.themes ?? window.api?.themes

const snapshot = shallowRef<ThemeSnapshot | null>(null)
const unread = ref<string | null>(null)
const refused = ref<string | null>(null)
const busy = ref(false)

/** This section's own stylesheet for its cards' previews, in the head while it is mounted. */
let previews: HTMLStyleElement | null = null
let disposed = false

const isRefusal = (answer: unknown): answer is ThemeRefused =>
  typeof answer === 'object' && answer !== null && (answer as ThemeRefused).outcome === 'refused'

let latest = 0
async function read(): Promise<void> {
  const themes = bridge()
  if (!themes || disposed) return
  const mine = ++latest
  const current = (): boolean => !disposed && mine === latest
  try {
    const next = await themes.list()
    if (!current()) return
    const readings = await Promise.all(
      next.themes.map(async (row): Promise<[string, ThemeReading | null]> => {
        if (row.status !== 'ok') return [row.id, null]
        const answer = await themes.read(row.id).catch(() => null)
        return [row.id, answer && !isRefusal(answer) ? answer : null]
      }),
    )
    if (!current() || !previews) return
    previews.textContent = readings.map(([id, r]) => previewCss(id, r)).join('')
    snapshot.value = next
    unread.value = null
  } catch (error) {
    if (current()) unread.value = readableError(error)
  }
}

/** Runs one action; a refusal is said on the section in the host's own words. */
async function act(action: (themes: ThemesBridge) => Promise<unknown>): Promise<unknown> {
  const themes = bridge()
  if (!themes || disposed) return null
  busy.value = true
  refused.value = null
  try {
    const answer = await action(themes)
    if (!disposed && isRefusal(answer)) {
      refused.value = answer.problems[0]?.says ?? THEME_WORDS.notDone
    }
    return answer
  } catch (error) {
    if (!disposed) refused.value = readableError(error)
    return null
  } finally {
    if (!disposed) {
      busy.value = false
      await read()
    }
  }
}

const use = (row: ThemeRow) => act((themes) => themes.set(row.id))
const duplicate = (row: ThemeRow) =>
  act((themes) => themes.duplicate(row.id, THEME_WORDS.copyName(row.name)))
async function remove(row: ThemeRow): Promise<void> {
  const answer = await act((themes) => themes.delete(row.id))
  if (!disposed && answer && !isRefusal(answer)) useOverlays().notify(THEME_WORDS.deleted)
}
const openFolder = () => act((themes) => themes.openFolder())

let unsubscribe: (() => void) | undefined
onMounted(() => {
  previews = document.createElement('style')
  previews.dataset.themePreviews = ''
  document.head.appendChild(previews)
  void read()
  unsubscribe = onThemesChanged(() => void read())
})
onUnmounted(() => {
  disposed = true
  latest++
  unsubscribe?.()
  previews?.remove()
  previews = null
})

/** Whether the section is open, remembered on this computer; open the first time. */
const open = usePersistentToggle('brobot2.providers.open.themes', true)
const bodyId = useId()
</script>

<template>
  <section class="themes" data-cy="themes-section">
    <span class="themes-icon" aria-hidden="true"
      ><svg class="icon"><use href="#i-layers" /></svg
    ></span>
    <h2>
      <button
        type="button"
        class="fold"
        :aria-expanded="open"
        :aria-controls="bodyId"
        data-cy="themes-fold"
        @click="open = !open"
      >
        {{ THEME_WORDS.section
        }}<svg class="icon chevron" :class="{ folded: !open }" aria-hidden="true">
          <use href="#i-chevron" />
        </svg>
      </button>
    </h2>
    <div v-show="open" :id="bodyId" class="themes-body">
      <p v-if="unread !== null" class="note" data-cy="themes-unread">{{ unread }}</p>
      <p v-if="refused !== null" class="note" role="alert" data-cy="themes-refused">
        {{ refused }}
      </p>
      <p v-if="snapshot?.reason" class="note" data-cy="themes-reason">{{ snapshot.reason }}</p>
      <ul class="cards">
        <li
          v-for="row in snapshot?.themes ?? []"
          :key="row.id"
          class="card"
          :class="{ active: row.id === snapshot?.active, refused: row.status !== 'ok' }"
          data-cy="theme-card"
          :data-theme-id="row.id"
        >
          <div class="mini" :data-theme-preview="row.id" aria-hidden="true">
            <div class="mini-bar"><span class="mini-mark" /></div>
            <div class="mini-body">
              <div class="mini-rail"><i /><i class="on" /><i /></div>
              <div class="mini-pane" data-preview-zone="content">
                <span class="mini-bubble" />
                <span class="mini-line" />
                <span class="mini-line short" />
                <span class="mini-composer"><span class="mini-send" /></span>
              </div>
            </div>
          </div>
          <div class="about">
            <h3 data-cy="theme-name">{{ row.name }}</h3>
            <span v-if="row.source === 'built-in'" class="tag" data-cy="theme-built-in">{{
              THEME_WORDS.builtIn
            }}</span>
          </div>
          <p v-if="row.status !== 'ok'" class="note" data-cy="theme-refused">
            {{ THEME_WORDS.cannotUse(row.reason ?? '') }}
          </p>
          <!-- A theme that loads, with what the readability check now says about it. -->
          <p v-else-if="row.reason" class="note" data-cy="theme-notes">{{ row.reason }}</p>
          <div class="actions">
            <span v-if="row.id === snapshot?.active" class="in-use" data-cy="theme-in-use">{{
              THEME_WORDS.inUse
            }}</span>
            <button
              v-else
              type="button"
              class="primary"
              data-cy="theme-use"
              :disabled="busy || row.status !== 'ok'"
              @click="use(row)"
            >
              {{ THEME_WORDS.use }}
            </button>
            <button
              type="button"
              data-cy="theme-duplicate"
              :disabled="busy || row.status !== 'ok'"
              @click="duplicate(row)"
            >
              {{ THEME_WORDS.duplicate }}
            </button>
            <button
              v-if="row.source === 'mine'"
              type="button"
              class="danger"
              data-cy="theme-delete"
              :disabled="busy"
              @click="remove(row)"
            >
              {{ THEME_WORDS.delete }}
            </button>
          </div>
        </li>
      </ul>
      <div>
        <button type="button" data-cy="themes-open-folder" :disabled="busy" @click="openFolder">
          {{ THEME_WORDS.openFolder }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.themes {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-7) var(--space-8) var(--space-7) calc(var(--space-24) + var(--space-16));
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  gap: var(--space-3);
}
.themes-icon {
  position: absolute;
  top: var(--space-6);
  left: var(--space-6);
  display: grid;
  width: var(--space-24);
  height: var(--space-24);
  place-items: center;
  border: var(--border-width) solid var(--accent-border-weak);
  border-radius: var(--radius-card);
  background: var(--accent-fill);
  color: var(--accent);
}
.themes-icon .icon {
  width: var(--space-16);
  height: var(--space-16);
  fill: none;
  stroke: currentColor;
}
h2 {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}
.fold {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  gap: var(--space-2);
}
.chevron {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
  transform: rotate(90deg);
}
.chevron.folded {
  transform: none;
}
.themes-body {
  display: contents;
}
.note {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.cards {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-6);
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  list-style: none;
}
.card {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  gap: var(--space-3);
}
.card.active {
  border-color: var(--accent-border);
  box-shadow: var(--accent-glow);
}
.about {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
h3 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
  overflow-wrap: anywhere;
}
.tag,
.in-use {
  color: var(--muted);
  font-size: var(--type-caption);
}
.in-use {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.danger {
  color: var(--danger);
}

/* The preview: a small window painted as the window paints the theme, from the colours its card's
   stylesheet works out, each falling back to the app's own look. It is a picture of the theme, so it
   takes no pointer and no reader's attention. */
.mini {
  display: flex;
  overflow: hidden;
  height: 108px;
  flex-direction: column;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.mini-bar {
  display: flex;
  height: 14px;
  flex: none;
  align-items: center;
  padding: 0 var(--space-2);
  background-color: var(--titlebar-bg-color, var(--preview-frame, var(--bg)));
  background-image: var(--titlebar-bg-image, none);
  background-position: var(--titlebar-bg-position, 0% 0%);
  background-repeat: var(--titlebar-bg-repeat, repeat);
  background-size: var(--titlebar-bg-size, auto);
  image-rendering: var(--titlebar-bg-rendering, auto);
}
.mini-mark {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-xs);
  background-color: var(--frame-accent, var(--accent));
}
.mini-body {
  display: flex;
  min-height: 0;
  flex: 1;
}
.mini-rail {
  display: flex;
  width: 34%;
  flex-direction: column;
  padding: var(--space-2);
  background-color: var(--rail-bg-color, var(--preview-frame, var(--bg)));
  background-image: var(--rail-bg-image, none);
  background-position: var(--rail-bg-position, 0% 0%);
  background-repeat: var(--rail-bg-repeat, repeat);
  background-size: var(--rail-bg-size, auto);
  gap: var(--space-2);
  image-rendering: var(--rail-bg-rendering, auto);
}
.mini-rail i {
  height: 6px;
  border-radius: var(--radius-xs);
  background: var(--frame-ink, var(--chrome-text));
  opacity: 0.35;
}
.mini-rail i.on {
  background: var(--frame-accent, var(--accent));
  opacity: 0.9;
}
.mini-pane {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-3);
  background-color: var(--conversation-bg-color, var(--preview-page, var(--chat-bg)));
  background-image: var(--conversation-bg-image, none);
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  gap: var(--space-2);
  image-rendering: var(--conversation-bg-rendering, auto);
}
.mini-bubble {
  width: 70%;
  height: 16px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-base, var(--radius-sm));
  background: var(--content-paper, var(--panel));
}
.mini-line {
  width: 85%;
  height: 4px;
  border-radius: var(--radius-xs);
  background: var(--content-ink, var(--text));
  opacity: 0.55;
}
.mini-line.short {
  width: 55%;
}
.mini-composer {
  display: flex;
  height: 16px;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--space-2);
  margin-top: auto;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-base, var(--radius-sm));
  background: var(--composer-field-bg, var(--content-paper, var(--panel)));
}
.mini-send {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--content-accent, var(--accent));
}
</style>
