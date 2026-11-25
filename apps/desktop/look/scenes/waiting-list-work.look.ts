import { scene } from '../capture'
import { waitingList } from '../fixtures/waiting-lists'

scene('waiting-list-work', (stage) => waitingList(stage, 'work'))
