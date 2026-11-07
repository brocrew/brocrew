// Explicit app compatibility verdict. This never turns Chrome failure into Chrome success.
export const publishedChrome018Sha256='d05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0'
export function chromeCompatibilityResult({version,sha256,reply,serverClosed,stderr=[]}) {
  const result=(status,reason)=>({status,reason,chromePassed:status==='PASS'})
  if(version!=='0.1.8'||sha256!==publishedChrome018Sha256)return result('FAIL','Chrome is not the exact published 0.1.8 archive')
  if(reply?.ok===true)return result('PASS','Chrome Settings operation succeeded; normal Chrome tool checks remain required')
  const codes=[reply?.code,...(Array.isArray(reply?.codes)?reply.codes:[]),reply?.mutationFailure].filter(Boolean)
  if(codes.some(code=>code!=='unavailable'))return result('FAIL','Chrome failed with a different error code')
  if(!codes.includes('unavailable')&&!serverClosed)return result('FAIL','Chrome failure is not unavailable/server-closed')
  const captured=stderr.filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim())
  if(!captured.length)return result('PARTIAL','Chrome unavailable, cause unproven: no captured Chrome stderr/card diagnostic')
  const identity=/(?:^|:\s*)Cannot confirm plugin process identity[.!]?\s*$/m
  const masked=/^agent-chrome:\s*cannot start(?::\s*Error)?\s*$/m
  const recognized=value=>identity.test(value)||masked.test(value)
  if(captured.some(value=>!recognized(value)))return result('FAIL','Chrome has a different captured startup diagnostic')
  for(const value of captured)for(const line of value.split(/\r?\n/)) {
    if((/^agent-chrome:/.test(line)||/^(?:\w*Error(?:\s*\[[^\]]+\])?|E[A-Z0-9_]+):/.test(line))&&!recognized(line))return result('FAIL','Chrome stderr includes another startup error')
  }
  return result('KNOWN-ISSUE','Exact published Chrome 0.1.8 failed with the captured identity-startup diagnostic; Chrome did not pass')
}
