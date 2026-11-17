import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('the macOS bundle', () => {
  it('offers one-time-code AutoFill only in fields marked for it, so a focused field starts no AutoFill helper', () => {
    const config = load(readFileSync(join(here, '../electron-builder.yml'), 'utf8')) as {
      mac: { extendInfo: Record<string, unknown> }
    }
    expect(config.mac.extendInfo.NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac).toBe(true)
  })
})
