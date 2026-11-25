import { scene } from '../capture'
import { waitingList } from '../fixtures/waiting-lists'

scene('waiting-list-questions', (stage) => waitingList(stage, 'questions'))
