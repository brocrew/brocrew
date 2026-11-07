import { win32 } from 'node:path'
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
  const identity=/^(?:(?:agent-chrome:\s*cannot start:\s*)?Error:\s*)?Cannot confirm plugin process identity[.!]?\s*$/
  const wrapper=/^(?:agent-chrome:\s*cannot start(?::\s*Error)?|Error)\s*$/
  let identitySeen=false
  for(const value of captured)for(const line of value.split(/\r?\n/)) {
    if(!line.trim())continue
    if(identity.test(line.trim()))identitySeen=true
    else if(!wrapper.test(line.trim())&&!/^\s+at\s+\S/.test(line))return result('FAIL','Chrome stderr includes another startup diagnostic')
  }
  if(!identitySeen)return result('PARTIAL','Chrome unavailable, cause unproven: generic startup wrapper does not identify the cause')
  if(!serverClosed)return result('PARTIAL','Chrome unavailable, cause unproven: no fresh matching server-closed receipt for this attempt')
  return result('KNOWN-ISSUE','Exact published Chrome 0.1.8 failed with the captured identity-startup diagnostic; Chrome did not pass')
}

export function appCompatibilityVerdict(complete,chromeStatus) {
  if(!complete||chromeStatus==='FAIL')return 'FAIL'
  if(chromeStatus==='PARTIAL')return 'PARTIAL'
  if(chromeStatus==='KNOWN-ISSUE')return 'APP-COMPAT-PASS-WITH-KNOWN-CHROME-ISSUE'
  return 'PASS'
}

export function freshClosedChromeRuns(before,after,sha256=publishedChrome018Sha256) {
  const directory=row=>win32.dirname(row.path).toLowerCase()
  const priorIds=new Set(before.map(row=>row.value.runId)),priorDirectories=new Set(before.map(directory))
  const current=after.filter(row=>typeof row.value.runId==='string'&&row.value.runId.length>0&&Number.isSafeInteger(row.value.guardianPid)&&row.value.guardianPid>0&&Array.isArray(row.value.groups)&&row.value.groups.length>0&&row.value.pluginId==='chrome'&&row.value.releaseDigest===sha256&&!priorIds.has(row.value.runId)&&!priorDirectories.has(directory(row)))
  return current.filter(row=>win32.basename(row.path)==='process.json').flatMap(start=>{
    const exit=current.find(row=>win32.basename(row.path)==='exit.json'&&directory(row)===directory(start)&&row.value.runId===start.value.runId&&row.value.pluginId===start.value.pluginId&&row.value.releaseDigest===start.value.releaseDigest&&row.value.guardianPid===start.value.guardianPid&&row.value.exited===true&&row.value.cause==='server-closed'&&JSON.stringify(row.value.groups)===JSON.stringify(start.value.groups))
    return exit?[{process:start,exit}]:[]
  })
}
