import { defineComponent, h, ref } from 'vue'
import { scene } from '../capture'
import { settle, windowStage } from '../fixtures/window'
import {
  createFilesLibrary,
  provideFilesLibrary,
} from '../../src/renderer/src/composables/useFilesLibrary'
import { provideMainTab } from '../../src/renderer/src/composables/useMainTab'
import { filesLibraryReplies } from '../../test/fixtures/files-library-replies'
import FilesLibraryPreview from '../../src/renderer/src/components/FilesLibraryPreview.vue'
import type { ResourceReading } from '../../src/shared/runtime-ipc'

// The accepted fictional 80/86 population, drawn by the real pane, toolbar and library components.
scene('workspace-files', async (stage) => {
  const fixture = filesLibraryReplies(true)
  const read = async (resourceId: string): Promise<ResourceReading> => {
    const file = fixture.keeps.find((one) => one.resourceId === resourceId)!
    const content = fixture.source.files.find((one) => one.sha256 === file.sha256)
    const body =
      content && 'body' in content && typeof content.body === 'string'
        ? content.body
        : '# Fictional document'
    return {
      ok: true,
      resourceId,
      name: file.name,
      form: file.form ?? 'markdown',
      bytes: file.bytes,
      text: file.form === 'image' || file.form === 'pdf' ? null : body,
    }
  }
  const window = windowStage({
    pane: { drawerOpen: false, onReadResource: read },
    railCollapsed: stage.width < 900,
    titleBar: true,
  })
  const component = defineComponent({
    setup() {
      const library = createFilesLibrary({
        read: fixture.read,
        workspace: () => 'fictional',
        selected: () => ({ id: 'brobot', name: 'CODEX interim' }),
      })
      provideFilesLibrary(library)
      provideMainTab(ref('files'))
      return () =>
        h('div', { style: 'display:flex;flex:1;min-height:0;min-width:0' }, [
          h(window),
          h(FilesLibraryPreview, {
            library,
            workspace: 'fictional',
            read,
          }),
        ])
    },
  })
  stage.mount(component, {})
  await settle()
})
