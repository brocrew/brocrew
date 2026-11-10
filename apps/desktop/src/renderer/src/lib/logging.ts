import log from 'electron-log/renderer'

Object.assign(console, log.functions)
log.errorHandler.startCatching({ preventDefault: false, showDialog: false })
