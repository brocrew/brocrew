import fs from 'node:fs'
import { readOwnedFile, rootWitness } from './owned-files.mjs'
import path from 'node:path'
import { projectBuild } from '../plugin-packaged/contract.mjs'
import { demand, once, hash, LIST, URL, MARKER } from './contract.mjs'

// No arbitrary source URL, environment setting, package, manifest or consent override.
// Both desktop-main and supervisor bundles import this through their ORIGINAL download.ts.
export function fetchSource({ root, token, candidate }) {
  const rootStamp = rootWitness(root)
  demand(hash(candidate) === LIST && /^[a-f0-9]{64}$/.test(token))
  const empty = Buffer.from(
    JSON.stringify({
      ...JSON.parse(candidate),
      entries: JSON.parse(candidate).entries.map((e) => ({ ...e, minAppVersion: '999.0.0' })),
    }),
  )
  return `// ${MARKER}\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {createHash} from 'node:crypto';
const root=${JSON.stringify(root)}, token=${JSON.stringify(token)}, expected=${JSON.stringify(LIST)};
const candidate=Buffer.from(${JSON.stringify(candidate.toString('base64'))},'base64');
const empty=Buffer.from(${JSON.stringify(empty.toString('base64'))},'base64');
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const native=globalThis.fetch;
${readOwnedFile.toString()}
const rootStamp=${JSON.stringify(rootStamp)};
const owned=(name:string,max:number)=>readOwnedFile(path.join(root,name),max,rootStamp);
export const gateFetch:typeof fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(u.href!==${JSON.stringify(URL)})return native(input,init);
 if(fs.realpathSync.native(root)!==root||owned('gate-token',64).toString()!==token||sha(candidate)!==expected)throw new Error('Gate binding refused');
 const mode=owned('list-mode',16).toString();if(!['candidate','empty'].includes(mode))throw new Error('Gate mode refused');
 const body=mode==='candidate'?candidate:empty;
 const actor=process.versions.electron?'client':'owner';
 // No URL query, auth, PID, path, provider or consent is exported.
 fs.appendFileSync(path.join(root,'fetch-'+actor+'.jsonl'),JSON.stringify({gate:${JSON.stringify(MARKER)},actor,mode,sha256:sha(body),synthetic:true})+'\\n',{mode:0o600});
 return new Response(body,{status:200,headers:{'content-length':String(body.length),'content-encoding':'identity'}});
};\n`
}
export function project(repo, options) {
  const main = path.join(repo, 'apps/desktop/src/main/index.ts')
  const config = fs.readFileSync(
    path.join(repo, 'apps/desktop/src/main/plugins/catalogue/build-config.ts'),
    'utf8',
  )
  const download = path.join(repo, 'apps/desktop/src/main/plugins/catalogue/download.ts')
  const shim = path.join(repo, 'apps/desktop/src/main/plugins/catalogue/v2-gate-fetch.ts')
  const original = {
    main: fs.readFileSync(main, 'utf8'),
    download: fs.readFileSync(download, 'utf8'),
  }
  demand(!fs.existsSync(shim))
  const p = projectBuild(config, original.main, options.appData, options.browser)
  const fixture = `            /* packaged-plugin-gate-only */ fixtureSource: ${JSON.stringify(path.join(options.appData, 'repo-fixture'))},\n`
  // Drive-qualified ESM imports must use forward slashes in the Windows Vite build.
  const provider = path.join(
    path.dirname(options.appData),
    'repo/scripts/gates/plugin-packaged/provider-fixture.mjs',
  )
  const entry = once(p.entry, fixture, '').replace(
    JSON.stringify(provider),
    JSON.stringify(provider.replaceAll('\\', '/')),
  )
  demand(!entry.includes('fixtureSource:') && !entry.includes('repo-fixture'))
  const transport =
    `// ${MARKER}\nimport {gateFetch} from './v2-gate-fetch';\n` +
    once(
      original.download,
      '(options.fetch ?? fetch)(url, {',
      '(options.fetch ?? gateFetch)(url, {',
    )
  fs.writeFileSync(shim, fetchSource(options), { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(main, entry)
  fs.writeFileSync(download, transport)
  return {
    restore() {
      fs.writeFileSync(main, original.main)
      fs.writeFileSync(download, original.download)
      fs.unlinkSync(shim)
      demand(
        fs.readFileSync(main, 'utf8') === original.main &&
          fs.readFileSync(download, 'utf8') === original.download,
      )
    },
  }
}
export function bundleProof(repo) {
  const main = fs.readFileSync(path.join(repo, 'apps/desktop/out/main/index.js'), 'utf8')
  const owner = fs.readFileSync(
    path.join(repo, 'apps/desktop/resources/plugin-supervisor/entry.cjs'),
    'utf8',
  )
  // Stable string data must survive bundling in EACH independent entrypoint.
  for (const s of [main, owner])
    demand(s.includes(LIST) && s.includes('fetch-') && s.includes('gate-token'))
  return { main: true, owner: true, mainSha256: hash(main), ownerSha256: hash(owner) }
}
