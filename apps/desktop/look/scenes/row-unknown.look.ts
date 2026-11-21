import UnknownEntry from '../../src/renderer/src/components/UnknownEntry.vue'
import { scene } from '../capture'

/** 🎨 An event the app has no drawing for, folded, with its provider label. Fake data. */
scene('row-unknown', (stage) => {
  stage.mount(
    UnknownEntry,
    {
      item: {
        kind: 'unknown',
        id: 'evt_1',
        provider: 'claude',
        category: 'unrecognized',
        label: 'sample/event',
        raw: { type: 'sample/event', note: 'made up' },
      },
    },
    { width: 640 },
  )
})
