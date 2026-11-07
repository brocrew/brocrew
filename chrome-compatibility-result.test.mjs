import assert from 'node:assert/strict'
import { chromeCompatibilityResult, publishedChrome018Sha256, appCompatibilityVerdict, freshClosedChromeRuns } from './chrome-compatibility-result.mjs'
const base={version:'0.1.8',sha256:publishedChrome018Sha256,reply:{ok:false,mutationFailure:'unavailable'},serverClosed:true,stderr:['Cannot confirm plugin process identity']}
const cases=[
 [base,'KNOWN-ISSUE'],
 [{...base,serverClosed:false},'PARTIAL'],
 [{...base,stderr:['Cannot confirm plugin process identity\nfatal: missing entry']},'FAIL'],
 [{...base,stderr:['Error: Cannot confirm plugin process identity\n    at startup (server.mjs:1:1)']},'KNOWN-ISSUE'],
 [{...base,stderr:['agent-chrome: cannot start: Error']},'PARTIAL'],
 [{...base,reply:{ok:true},stderr:[]},'PASS'],
 [{...base,stderr:[]},'PARTIAL'],
 [{...base,stderr:['   ']},'PARTIAL'],
 [{...base,sha256:'0'.repeat(64)},'FAIL'],
 [{...base,version:'0.1.9'},'FAIL'],
 [{...base,reply:{ok:false,codes:['policy-refused']}},'FAIL'],
 [{...base,reply:{ok:false,codes:['hash-mismatch']}},'FAIL'],
 [{...base,reply:{ok:false},serverClosed:false},'FAIL'],
 [{...base,stderr:['agent-chrome: cannot start: EACCES']},'FAIL'],
 [{...base,stderr:['TypeError: incorrect configuration']},'FAIL'],
 [{...base,stderr:['Cannot confirm plugin process identity\nTypeError: incorrect configuration']},'FAIL'],
 [{...base,stderr:['Cannot confirm plugin process identity','another startup failure']},'FAIL'],
 [{...base,stderr:['Cannot confirm plugin process identity\nENOENT: missing runtime']},'FAIL'],
 [{...base,stderr:['Cannot confirm plugin process identity because hash mismatch']},'FAIL'],
]
for(const [input,status]of cases){const actual=chromeCompatibilityResult(input);assert.equal(actual.status,status,JSON.stringify(input));assert.equal(actual.chromePassed,status==='PASS')}
console.log(JSON.stringify({passed:cases.length,scope:'explicit Chrome-only compatibility predicate; wrong causes never accepted'}))

for(const [complete,chrome,verdict]of [[false,'KNOWN-ISSUE','FAIL'],[false,'PARTIAL','FAIL'],[true,'FAIL','FAIL'],[true,'PARTIAL','PARTIAL'],[true,'KNOWN-ISSUE','APP-COMPAT-PASS-WITH-KNOWN-CHROME-ISSUE'],[true,'PASS','PASS'],[true,undefined,'PASS']])assert.equal(appCompatibilityVerdict(complete,chrome),verdict)
console.log(JSON.stringify({appVerdictControls:7,otherMandatoryFailureOverridesKnownChrome:true,partialNeverGreen:true}))

const row=(run,name,extra={})=>({path:`C:\\fixture\\${run}\\${name}.json`,value:{runId:run,pluginId:'chrome',releaseDigest:publishedChrome018Sha256,guardianPid:10,groups:[[11,'123']],...extra}})
const process=row('new','process'),exit=row('new','exit',{exited:true,cause:'server-closed'})
const staleProcess=row('old','process'),staleExit=row('old','exit',{exited:true,cause:'server-closed'})
assert.equal(freshClosedChromeRuns([],[process,exit]).length,1)
assert.equal(freshClosedChromeRuns([staleProcess],[staleProcess,staleExit]).length,0)
assert.equal(freshClosedChromeRuns([{...staleProcess,path:process.path}],[process,exit]).length,0)
for(const mutation of [{runId:'other'},{guardianPid:99},{releaseDigest:'0'.repeat(64)},{exited:false},{groups:[[12,'124']]}])assert.equal(freshClosedChromeRuns([],[process,{...exit,value:{...exit.value,...mutation}}]).length,0)
assert.equal(freshClosedChromeRuns([],[exit]).length,0)
for(const mutation of [{runId:undefined},{guardianPid:null},{groups:[]}])assert.equal(freshClosedChromeRuns([],[{...process,value:{...process.value,...mutation}},{...exit,value:{...exit.value,...mutation}}]).length,0)
console.log(JSON.stringify({freshRunControls:12,lateExitFromExistingRunRejected:true,matchingProcessExitRequired:true}))
