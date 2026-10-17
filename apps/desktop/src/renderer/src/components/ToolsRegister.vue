<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  EXTERNAL_MCP_NONE_YET,
  EXTERNAL_MCP_REGISTER_IS,
  EXTERNAL_MCP_REGISTER_IS_NOT_A_REPORT,
  EXTERNAL_MCP_REMOVAL_MEANS,
} from '../../../shared/external-mcp'
import type { ProviderCapabilityMap } from '../../../shared/runtime-ipc'
import {
  grantedWords,
  registeredServers,
  registeredWords,
  whatEachProviderDoesWithThem,
} from '../lib/the-servers-this-app-registered'
import type { AgentStore } from '../lib/agent-store'
import { useAgentStore } from '../composables/useAgentStore'
import { usePersonsQueue } from '../lib/persons-queue'
import McpServerRequests from './McpServerRequests.vue'

/**
 * 🔴 **The Tools register — every external server this app has registered, and what each one is**
 * (566, `564`'s smallest standalone slice, `EXT-008` §4.1).
 *
 * > ⚑ **`EXT-008` §4.1:** *"Add a Tools destination. External MCP servers are real now and
 * > registered ones need a home. The mockup has no slot for them."*
 *
 * ## ⛔ A READ, and the two refusals that make it one
 *
 * ⚠️ **`564` priced this slice as *"a read-only Tools projection over the existing external-server
 * registry, with no health claim and no Add-server action"*.** ⛔ **The health claim stays refused
 * and always will** — {@link EXTERNAL_MCP_REGISTER_IS_NOT_A_REPORT} is that refusal, said to the
 * person rather than left in a docblock. 🔴 **The Add-server action is taken, and the difference is
 * that v2.10 had no host and this app does**: `Add server…` opens
 * {@link ExternalMcpRegistry}, which `516` shipped with the real fields, the real reach radios, the
 * real collision refusal and the real *"the server was not running"* sentence. ⚑ **`566` §3 made it
 * this dispatch's call — *"if it is cheap and honest, take it"* — and the honest form was to route
 * to the flow that exists, never to draw a second one.** ⛔ v2.10 disables its button because
 * *"no credential fields, guessed product registration form or local pretend registration is
 * supplied"*; this one is not a pretend registration, it is the only one there has ever been.
 *
 * ## ⚑ What a row may show, and the four fields that are NOT on it
 *
 * ⛔ **Five columns exist and five are drawn** — see {@link registeredServers}, which is `564`'s
 * *"adapter for safe fields"* and carries the argument for why no redaction step is owed.
 * ⚠️ **v2.10's register also draws a description, a transport pill, a tool standing and reported
 * conversation links.** This product has none of the four: there is no description column, stage 1
 * is loopback HTTP and nothing else so a transport pill would be a constant, the tool list obtained
 * at registration is used for the collision check and thrown away, and a conversation link is the
 * session inventory this page refuses to be. ⛔ **Every one of those is a field to ask for, not a
 * field to invent** — `566` §6: *"if you need a field the renderer does not have, NAME it and
 * stop."* They are named in this dispatch's response.
 *
 * The register appears in Settings and keeps its existing registration action.
 */
const props = withDefaults(
  defineProps<{
    /** ⚑ Injected in tests, the way {@link ExternalMcpRegistry} takes it — same store, same read. */
    store?: AgentStore
    /**
     * 🔴 **`566` §4.2 — what each provider does with a registered server, in its own words.**
     *
     * ⛔ **`null` is *nobody has asked the capability door yet* and draws NO block** (`086`). It is
     * not *every provider hands them over* and it is not *none does*.
     */
    capabilities?: ProviderCapabilityMap | null
    /**
     * ⚑ **The moment a registration's age is measured against** — sampled once per mount, which is
     * argued in {@link registeredWords}.
     */
    now?: number
    embedded?: boolean
  }>(),
  { store: undefined, capabilities: null, now: () => Date.now(), embedded: false },
)

const emit = defineEmits<{
  /** ⛔ **Emitted, never performed** — the overlay is `RuntimeScreen`'s, as every overlay is. */
  addServer: []
}>()

const store = props.store ?? useAgentStore()
const removing = ref<string | null>(null)
const removeRefusal = ref<string | null>(null)

async function remove(serverId: string): Promise<void> {
  if (removing.value !== null) return
  removing.value = serverId
  removeRefusal.value = null
  try {
    removeRefusal.value = await store.removeExternalMcp(serverId)
  } finally {
    removing.value = null
  }
}

/** ⚑ The fold, in a module a mutation row can reach — `468`'s rule. */
const servers = computed(() => registeredServers(store.identities.value))
const standings = computed(() => whatEachProviderDoesWithThem(props.capabilities))

/**
 * The agents' requests to register a server, drawn above the registered ones, with the ones decided
 * here; no band when there are none.
 */
const queue = usePersonsQueue()
const requested = computed(() => queue.serverRequests.value?.rows.length ?? 0)
const settledHere = computed(() => queue.serverRequestsSettled.value.length)
</script>

<template>
  <section class="tools-surface" data-cy="tools-register" data-chat-theme="light">
    <div class="page">
      <header class="page-head">
        <div class="head-copy">
          <h1 v-if="!embedded" class="bb-page-title">Tools</h1>
          <p data-cy="tools-register-is">{{ EXTERNAL_MCP_REGISTER_IS }}</p>
        </div>
        <span class="head-spacer"></span>
        <button
          class="primary bb-button bb-button--primary"
          type="button"
          data-cy="tools-add-server"
          @click="emit('addServer')"
        >
          Add server…
        </button>
      </header>

      <div class="tools-columns">
        <div class="tools-main">
          <section v-if="requested + settledHere > 0" class="band" data-cy="tools-asked-for">
            <div class="band-bar">
              <h2 class="bb-heading">Asked for by agents</h2>
              <span class="band-spacer"></span>
              <span class="count bb-chip" data-cy="tools-asked-for-count">{{ requested }}</span>
            </div>
            <McpServerRequests place="tools" />
          </section>
          <section class="band">
            <div class="band-bar">
              <h2 class="bb-heading">Registered servers</h2>
              <span class="band-spacer"></span>
              <span
                v-if="store.loaded.value && !store.loadError.value"
                class="count bb-chip"
                data-cy="tools-count"
                >{{ servers.length }}</span
              >
            </div>

            <p v-if="!store.loaded.value" class="note" data-cy="tools-loading">
              Reading the registered servers…
            </p>
            <p
              v-else-if="store.loadError.value"
              class="note err"
              data-cy="tools-load-error"
              role="alert"
            >
              <svg class="icon"><use href="#i-alert" /></svg>
              <span>{{ store.loadError.value }}</span>
            </p>

            <template v-else>
              <p v-if="servers.length === 0" class="empty" data-cy="tools-none">
                {{ EXTERNAL_MCP_NONE_YET }}
              </p>

              <ul v-else class="rows" data-cy="tools-rows">
                <li
                  v-for="server in servers"
                  :key="server.id"
                  class="row bb-card"
                  :data-cy="`tools-row-${server.name}`"
                >
                  <span class="row-head">
                    <strong :data-cy="`tools-name-${server.name}`">{{ server.name }}</strong>
                    <span class="reach bb-chip" :data-cy="`tools-reach-${server.name}`">{{
                      server.reachSays
                    }}</span>
                  </span>
                  <code class="address" :data-cy="`tools-url-${server.name}`">{{
                    server.url
                  }}</code>
                  <span class="row-foot">
                    <small :data-cy="`tools-registered-${server.name}`">{{
                      registeredWords(server.registeredAt, props.now)
                    }}</small>
                    <small
                      v-if="server.grantedTo !== null"
                      :data-cy="`tools-granted-${server.name}`"
                      >{{ grantedWords(server.grantedTo) }}</small
                    >
                  </span>
                  <p class="remove-means" :data-cy="`tools-removal-means-${server.name}`">
                    {{ EXTERNAL_MCP_REMOVAL_MEANS }}
                  </p>
                  <button
                    type="button"
                    class="bb-button"
                    :disabled="removing !== null"
                    :data-cy="`tools-remove-${server.name}`"
                    @click="remove(server.id)"
                  >
                    {{ removing === server.id ? 'Removing…' : 'Remove' }}
                  </button>
                </li>
              </ul>
            </template>
            <p v-if="removeRefusal" class="note err" role="alert" data-cy="tools-remove-refusal">
              {{ removeRefusal }}
            </p>
          </section>
        </div>

        <section
          v-if="standings.length > 0"
          class="band provider-guide bb-card"
          data-cy="tools-providers"
        >
          <div class="band-bar">
            <h2 class="bb-heading">What each provider is handed</h2>
          </div>
          <div
            v-for="standing in standings"
            :key="standing.provider"
            class="provider"
            :data-cy="`tools-provider-${standing.provider}`"
          >
            <strong>{{ standing.name }}</strong>
            <p :data-cy="`tools-provider-says-${standing.provider}`">{{ standing.says }}</p>
          </div>
        </section>
      </div>
      <p class="boundary" data-cy="tools-not-a-report">
        {{ EXTERNAL_MCP_REGISTER_IS_NOT_A_REPORT }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.tools-surface {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.tools-surface > * {
  image-rendering: auto;
}

.page {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-12);
  container-type: inline-size;
  overflow-y: auto;
  gap: var(--space-12);
}

.page-head {
  display: flex;
  align-items: flex-start;
  max-width: none;
  gap: var(--space-6);
}

.head-copy h1 {
  margin: 0;
  color: var(--text);
}

.head-copy p {
  margin: var(--space-3) 0 0;
  color: var(--text-soft);
  font-size: var(--type-body);
  line-height: var(--leading-relaxed);
}

.head-spacer {
  flex: 1;
}

.page-head button {
  flex: 0 0 auto;
}

.band {
  display: flex;
  max-width: none;
  flex-direction: column;
  gap: var(--space-4);
}

.band-bar {
  display: flex;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-3);
}

.band-bar h2 {
  margin: 0;
  color: var(--text);
}

.band-spacer {
  flex: 1;
}

.count {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.rows {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-4);
  list-style: none;
}

.row {
  display: flex;
  min-width: 0;
  flex-direction: column;

  gap: var(--space-3);
}

.row-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.row-head strong {
  color: var(--text);
  font-size: var(--type-reading);
}

.reach {
  color: var(--muted);
  font-size: var(--type-caption);
}

.address {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.row-foot {
  display: flex;
  flex-wrap: wrap;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-2) var(--space-5);
}

.remove-means {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

.row > button {
  align-self: flex-start;
}

.provider {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.provider strong {
  color: var(--text);
  font-size: var(--type-body);
}

.provider p {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.empty,
.note,
.boundary {
  display: flex;
  margin: 0;
  max-width: var(--measure-message);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: var(--leading-relaxed);
}

.note.err {
  color: var(--danger);
}

.note .icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin-top: 1px;
}

.tools-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: var(--space-12);
  align-items: start;
}
.head-copy {
  min-width: 0;
}
/* The agents' requests sit above the registered servers, in the same column. */
.tools-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-12);
}
.provider-guide {
  gap: var(--space-8);
}
.provider-guide .band-bar {
  border: 0;
  padding: 0;
}
.provider-guide .provider + .provider {
  padding-top: var(--space-6);
  border-top: var(--border-width) solid var(--line);
}
@container (max-width: 720px) {
  .tools-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
