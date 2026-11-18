import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/desktop/test/fixtures/cleanup-failure/*.case.ts'],
    environment: 'node',
  },
})
