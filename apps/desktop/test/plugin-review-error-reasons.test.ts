import { afterEach, expect, it } from 'vitest'
import { disclosureFixture, settingsPeer } from './plugin-disclosure-fixtures'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { PluginDownloadError } from '../src/main/plugins/catalogue/download'
import { PluginVerificationError } from '../src/main/plugins/verification-error'
import { pluginMutationFailureNotice } from '../src/shared/plugin-settings'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it.each([
  ['preview', 'integrity'],
  ['preview', 'verification'],
  ['owner', 'integrity'],
  ['owner', 'verification'],
] as const)('reports %s %s rejection without a false confirmation error', async (where, kind) => {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  const client = await f.connect(),
    download = where === 'preview' ? f.download : f.ownerDownload,
    before = f.f.state.inspect()
  if (kind === 'integrity') download.mockRejectedValueOnce(new PluginDownloadError('integrity'))
  else download.mockResolvedValueOnce(Buffer.from('fictional invalid package bytes'))
  const answer = await settingsPeer(client).call({
    kind: 'prepare',
    action: 'update',
    id: 'chrome',
  })
  expect(answer).toMatchObject({
    ok: false,
    mutationFailure: 'package-invalid',
    detail: "Couldn't verify this plugin package. Download it again or contact its publisher.",
  })
  if (answer.ok || !('mutationFailure' in answer) || !answer.mutationFailure)
    throw new Error('missing public package failure')
  expect(pluginMutationFailureNotice(answer.mutationFailure)).toBe(
    "Couldn't verify this plugin package. Download it again or contact its publisher.",
  )
  expect(f.f.state.inspect()).toEqual(before)
})

it('keeps real invalidation ahead of a simultaneous package verification rejection', async () => {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  const client = await f.connect()
  let started!: () => void, fail!: (error: Error) => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  f.download.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
        started()
      }),
  )
  const rejected = expect(client.reviewMutation!('update', 'chrome')).rejects.toMatchObject({
    code: 'policy-refused',
  })
  void rejected.catch(() => {})
  await begun
  client.cancelPreparations!()
  fail(new PluginVerificationError('digest'))
  await rejected
  expect(f.f.state.inspect().pending).toBeNull()
})
