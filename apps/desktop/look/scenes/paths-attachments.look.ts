import { defineComponent, h } from 'vue'
import { vi } from 'vitest'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import { useMessagePaths } from '../../src/renderer/src/composables/useMessagePaths'
import { boxOf, crop, scene } from '../capture'

// The headless browser has no Electron asset protocol, so serve fixture pixels on that boundary.
vi.mock('../../src/shared/asset-url', () => ({
  assetUrl: () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 72
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#a9cdda'
    ctx.fillRect(0, 0, 72, 72)
    ctx.fillStyle = '#f7db92'
    ctx.beginPath()
    ctx.arc(50, 22, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#407568'
    ctx.beginPath()
    ctx.moveTo(0, 72)
    ctx.lineTo(26, 30)
    ctx.lineTo(72, 72)
    ctx.fill()
    return canvas.toDataURL('image/png')
  },
}))

scene('paths-attachments', async (stage) => {
  const Host = defineComponent({
    setup() {
      const paths = useMessagePaths(
        () => 'capture-conversation',
        () => ({
          resolve: async ({ texts }) =>
            texts.map((text) =>
              text !== './design/notes.md'
                ? { text, found: false as const }
                : {
                    text,
                    found: true as const,
                    absolute: `/Users/river/project/${text.replace(/^\.\//, '')}`,
                    name: text.split('/').at(-1)!,
                    kind: 'file' as const,
                    opens: true,
                  },
            ),
          open: async () => ({ ok: true as const, did: 'opened' as const }),
          reveal: async () => ({ ok: true as const, path: '/Users/river/project' }),
        }),
      )
      return () =>
        h(
          'main',
          {
            'data-chat-theme': 'light',
            style: 'padding:32px;width:100%;background:var(--panel);',
          },
          [
            h(UserMessage, {
              paths: paths.value,
              item: {
                kind: 'user',
                id: 'capture-user',
                ordinal: 1,
                at: 1793300400000,
                text: 'Compare ./design/notes.md with these files.',
                attachments: [
                  {
                    path: '/Users/river/project/design/header.png',
                    kind: 'file',
                    outsideCwd: false,
                  },
                  { path: '/Users/river/Documents/brief.pdf', kind: 'file', outsideCwd: true },
                  {
                    path: '/Users/river/project/design/reference',
                    kind: 'directory',
                    outsideCwd: false,
                  },
                ],
              },
            }),
          ],
        )
    },
  })
  const m = stage.mount(Host, {})
  await new Promise((done) => setTimeout(done, 100))
  await crop(
    `paths-attachments-${import.meta.env['LOOK_PHASE'] ?? 'capture'}`,
    boxOf(m.host.querySelector('article')!),
  )
})
