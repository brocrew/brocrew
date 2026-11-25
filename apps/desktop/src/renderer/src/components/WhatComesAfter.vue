<script setup lang="ts">
/** What answering a permission does not cover, said the same wherever a permission is answered. */
import { WHAT_COMES_AFTER_IS_NOT_OURS } from '../lib/user-input-offer'
</script>

<template>
  <p data-cy="permission-after">{{ WHAT_COMES_AFTER_IS_NOT_OURS }}</p>
</template>
