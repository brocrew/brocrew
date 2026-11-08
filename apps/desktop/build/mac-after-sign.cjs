module.exports = async (context) => {
  const { afterSign } = await import('../../../scripts/mac-release-signing.mjs')
  await afterSign(context)
}
