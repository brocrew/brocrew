export class RecordWriteFailed extends Error {
  constructor(cause: unknown) {
    super('This conversation could not save the change: ' + String(cause), { cause })
    this.name = 'RecordWriteFailed'
  }
}
