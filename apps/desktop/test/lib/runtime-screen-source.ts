import { readFileSync } from 'node:fs'
import { codeWithoutProse } from './prose-spans'

const renderer = new URL('../../src/renderer/src/', import.meta.url)

type ScreenModule =
  | 'useRuntimeAttention'
  | 'useRuntimeNavigation'
  | 'useRuntimeQueueActions'
  | 'useRuntimeScreenReadings'

export function readScreenModules(...modules: ScreenModule[]): string {
  return modules
    .map((name) => readFileSync(new URL(`composables/${name}.ts`, renderer), 'utf8'))
    .map((source) => source.replace(/^ {2}/gm, ''))
    .join('\n')
}

export function runtimeScreenCode(): string {
  const frame = 'components/RuntimeScreen.vue'
  const files = [
    'composables/useRuntimeNavigation.ts',
    'composables/useRuntimeAttention.ts',
    'composables/useRuntimeScreenReadings.ts',
    'composables/useRuntimeQueueActions.ts',
  ]
  const code = (file: string): string =>
    codeWithoutProse(file, readFileSync(new URL(file, renderer), 'utf8'))
  return [code(frame), ...files.map((file) => code(file).replace(/^ {2}/gm, ''))].join('\n')
}
