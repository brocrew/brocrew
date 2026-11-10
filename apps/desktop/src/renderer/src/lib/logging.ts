import log from 'electron-log/renderer'

Object.assign(console, log.functions)
log.errorHandler.setOptions({ preventDefault: false, showDialog: false })
log.errorHandler.startCatching()
