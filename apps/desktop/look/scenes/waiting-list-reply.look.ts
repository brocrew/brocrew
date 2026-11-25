import { scene } from '../capture'
import { waitingList } from '../fixtures/waiting-lists'

scene('waiting-list-reply', (stage) => waitingList(stage, 'reply'))
