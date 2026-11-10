import { expect, it } from 'vitest'

it('preserves the old Codex form exports as the same functions and constants', async () => {
  const neutral = await import('../src/mcp-elicitation')
  const codex = await import('../src/codex/external-mcp')
  expect(codex.codexElicitation).toBe(neutral.mcpElicitation)
  for (const name of [
    'elicitationContent',
    'elicitationQuestions',
    'elicitationWords',
    'opensALink',
    'serverAsks',
    'SKIPPED',
    'BOOLEAN_CHOICES',
    'MAX_ELICITATION_URL',
  ] as const) {
    expect(codex[name]).toBe(neutral[name])
  }
})

it('preserves the image allow-list and settings bound across compatibility exports', async () => {
  const neutral = await import('../src/image-media-type')
  const images = await import('../src/codex/generated-image')
  const settings = await import('../src/settings-limits')
  const rules = await import('../src/claude/persisted-rules')
  expect(images.IMAGE_MEDIA_TYPES).toBe(neutral.IMAGE_MEDIA_TYPES)
  expect(images.imageMediaType).toBe(neutral.imageMediaType)
  expect(rules.MAX_SETTINGS_BYTES).toBe(settings.MAX_SETTINGS_BYTES)
  expect(neutral.imageMediaType('sample.PNG')).toBe('image/png')
  expect(neutral.imageMediaType('sample.svg')).toBeNull()
})
