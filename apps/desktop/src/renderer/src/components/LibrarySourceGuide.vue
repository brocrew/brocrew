<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ALL_PROVIDER_FOLDERS } from '../../../shared/runtime-ipc'
import { scanSummary, type HomeScan } from '../lib/home-scan'
import { ago } from '../lib/library-page-notes'
import ProviderLabel from './ProviderLabel.vue'

/** Where the library's rows come from, and what the last home scan found. */
const props = defineProps<{
  homeScan: HomeScan
  /** The scan's own failure, not the read's. */
  scanError: string | null
  /** The scan button's label, named in the sentence that says what it does. */
  checkHomesLabel: string
}>()

const scanNote = computed(() => scanSummary(props.homeScan.lastScan.value))
/**
 * When the last scan landed, in the same relative words the rows use.
 *
 * Null until one has, and the note is gated on BOTH — a freshness line that said "just now" for
 * ever, or "0m ago" about a scan nobody ran, would be this surface asserting something it has not
 * been told. There is no persisted last-scan time to read: what this reports is the press that
 * happened on this screen, and it says nothing about presses it did not see.
 */
const lastChecked = computed(() =>
  props.homeScan.scannedAt.value === null ? null : ago(props.homeScan.scannedAt.value, tick.value),
)

/**
 * ⛔ **A clock this component can see** (121, review). `ago()` reads `Date.now()`, which is not a
 * reactive dependency — so `lastChecked` was a `computed` that re-evaluated only when another scan
 * landed, and the note read *"last checked 0m ago"* for as long as the surface stayed open. The
 * comment above says in as many words that a line saying "just now" for ever is what this must not
 * be; it was that.
 *
 * A minute is the resolution `ago()` reports in, so anything finer would be work with nothing to
 * show for it. Started only once a scan has landed, and cleared on unmount.
 */
const tick = ref(Date.now())
let ticking: number | undefined
watch(
  () => props.homeScan.scannedAt.value,
  (at) => {
    if (at === null || ticking !== undefined) return
    ticking = window.setInterval(() => (tick.value = Date.now()), 60_000)
  },
)

// The freshness clock, which would otherwise keep waking a component that is gone.
onUnmounted(() => {
  if (ticking !== undefined) window.clearInterval(ticking)
})
</script>

<template>
  <section class="source-guide bb-card">
    <p class="reads" data-cy="library-reads">
      Includes conversations from {{ ALL_PROVIDER_FOLDERS }}, read-only. {{ checkHomesLabel }}
      searches agent folders separately.
    </p>

    <p v-if="scanNote && lastChecked" class="freshness" data-cy="library-scan-note">
      last checked {{ lastChecked }} — {{ scanNote }}
    </p>

    <p v-if="scanError" class="scan-failed" data-cy="library-scan-error">
      The homes could not be checked: {{ scanError }}
    </p>

    <details
      v-if="homeScan.lastScan.value && homeScan.lastScan.value.skipped.length > 0"
      class="scan-skipped"
      data-cy="library-scan-skipped"
    >
      <summary>{{ homeScan.lastScan.value.skipped.length }} found but not adopted — why</summary>
      <ul>
        <li v-for="item in homeScan.lastScan.value.skipped" :key="item.path" class="mono">
          <ProviderLabel :provider="item.provider" /> · {{ item.path }} — {{ item.reason }}
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
/* 🔴 **When this page reads the machine** (329 §4.3). Under the counts, above the scan's own
   report, and one step LOUDER than either — `--muted`, not the `--faint` of the footnotes around
   it. It is the only sentence on the page that says where the rows came from, and 031 rates a line
   nobody reads as worse than none. `max-width` because it is the longest line in the head and the
   layout sweep asserts nothing here overflows at 400px. */
.reads {
  max-width: 78ch;
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The scan's own result, under the counts it will change. `--faint` like the counts: it is a
   footnote about freshness, not a claim competing with the library's own numbers. */
.freshness {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The one place on this surface that reports something having gone wrong outside a row, and it is
   the danger ramp for the same reason the banner is: a scan that failed is not a state. */
.scan-failed {
  margin: var(--space-2) 0 0;
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The scan's own rejects, in the shape the rail already draws them. Quiet, and closed by default:
   it is a footnote about files, not a failure. */
.scan-skipped {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.scan-skipped summary {
  cursor: pointer;
}

.scan-skipped ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}
.source-guide .reads {
  margin: 0;
}
.source-guide {
  overflow-wrap: anywhere;
}
</style>
