import { expect, it } from 'vitest'
import { pluginToolRefusalLog } from '../src/main/plugins/lifecycle/chrome-broker'
import { captureLog } from './lib/log-file'

it('logs the first tool refusal once and not again for later connections', async () => {
  const captured = await captureLog()
  try {
    const record = pluginToolRefusalLog()
    record()
    record()
    pluginToolRefusalLog()()
    const lines = await captured.lines(2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await captured.lines(2)).toHaveLength(2)
    for (const line of lines) expect(line).toContain('Some plugin tools were refused.')
  } finally {
    await captured.close()
  }
})
