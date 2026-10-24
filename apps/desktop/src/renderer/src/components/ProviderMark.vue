<script setup lang="ts">
import type { Provider, ProviderCapabilities } from '../../../shared/runtime-ipc'
import blossomBlack from '../assets/OAI_OpenAI-Blossom_Black.svg'
import blossomWhite from '../assets/OAI_OpenAI-Blossom_White.svg'

defineProps<{
  provider: Provider | string
  name?: string
  kind?: ProviderCapabilities['mark']['kind'] | null
  size?: 'card' | 'setup'
}>()
</script>

<template>
  <span
    class="provider-mark"
    :class="{ 'provider-mark--setup': size === 'setup' }"
    :data-provider-mark="provider"
    aria-hidden="true"
  >
    <span v-if="kind !== 'blossom'" class="provider-mark__claude">{{
      (name ?? provider).slice(0, 1).toUpperCase()
    }}</span>
    <template v-else-if="kind === 'blossom'">
      <img class="provider-mark__black" :src="blossomBlack" alt="" />
      <img class="provider-mark__white" :src="blossomWhite" alt="" />
    </template>
  </span>
</template>

<style scoped>
.provider-mark {
  display: grid;
  width: var(--icon-display);
  height: var(--icon-display);
  flex: none;
  place-items: center;
}
.provider-mark--setup {
  width: var(--icon-lg);
  height: var(--icon-lg);
}
.provider-mark__claude {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border-radius: var(--radius-seg-tight);
  background: var(--accent);
  color: var(--accent-ink);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
  line-height: 1;
}
.provider-mark--setup .provider-mark__claude {
  font-size: var(--type-base);
}
.provider-mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.provider-mark__black {
  display: none;
}
.provider-mark__white {
  display: block;
}
:global([data-chat-theme='light'] .provider-mark__black),
:global([data-on-white] .provider-mark__black) {
  display: block;
}
:global([data-chat-theme='light'] .provider-mark__white),
:global([data-on-white] .provider-mark__white) {
  display: none;
}
:global(:root[data-content-scheme='dark'] .provider-mark__black) {
  display: none;
}
:global(:root[data-content-scheme='dark'] .provider-mark__white) {
  display: block;
}
</style>
