import { pluginSha256 } from '../../src/main/plugins/package-digests'
import { tar } from '../plugin-package-fixtures'

export const thirdPluginId = 'fictional-pebble-box'
export type ThirdPluginTransport = 'stdio' | 'streamable-http'

/** Package code only: the app has no knowledge of these tools, fields or opaque files. */
const peer = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import http from 'node:http';
const revision = RELEASE;
const transport = TRANSPORT;
const home = process.env.BROCREW_PLUGIN_DATA;
const shared = process.env.BROCREW_PLUGIN_SHARED;
const bootstrap = JSON.parse(process.env.BROCREW_PLUGIN_BOOTSTRAP);
const settingsPath = path.join(home, 'settings.json');
const journal = path.join(home, 'calls.jsonl');
if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, JSON.stringify({label:'unconfigured'}));
for (const directory of [home,shared]) {
 if (!fs.existsSync(path.join(directory,'opaque.bin'))) fs.writeFileSync(path.join(directory,'opaque.bin'),Buffer.from([0,255,3,17,128]));
}
fs.appendFileSync(path.join(home,'boots.jsonl'),JSON.stringify({revision,bootstrap,pid:process.pid})+'\n');
const names = ['pebble.echo','pebble.read_settings','pebble.write_settings','pebble.tool_error','pebble.protocol_error','pebble.lose_reply','pebble.cleanup',...(revision===2?['pebble.count']:[])];
function handle(packet) {
 if(packet.id===undefined) return;
 const result = value=>({jsonrpc:'2.0',id:packet.id,result:value});
 const error = (code,message,data)=>({jsonrpc:'2.0',id:packet.id,error:{code,message,data}});
 if(packet.method==='initialize') return result({protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-pebble-peer',version:revision+'.0.0'},capabilities:{tools:{}}});
 if(packet.method==='tools/list') return result({tools:names.map(name=>({name,description:'Fictional '+name,inputSchema:{type:'object',additionalProperties:true}}))});
 if(packet.method!=='tools/call') return error(-32601,'Fictional method absent',{method:packet.method});
 const {name,arguments:args={},_meta:meta}=packet.params;
 fs.appendFileSync(journal,JSON.stringify({revision,name,args,meta})+'\n');
 if(!names.includes(name)) return error(-32601,'Fictional tool absent',{name});
 if(name==='pebble.protocol_error') return error(-32602,'Fictional invalid pebble',{field:'basket',revision});
 if(name==='pebble.tool_error') return result({isError:true,content:[{type:'text',text:'Fictional basket is full'}],structuredContent:{reason:'fictional-full',revision}});
 if(name==='pebble.lose_reply') { setImmediate(()=>process.exit(19)); return; }
 if(name==='pebble.write_settings') fs.writeFileSync(settingsPath,JSON.stringify({...JSON.parse(fs.readFileSync(settingsPath,'utf8')),...args}));
 if(name==='pebble.cleanup') fs.appendFileSync(path.join(home,'explicit-cleanup.jsonl'),JSON.stringify({revision,args})+'\n');
 return result({content:[{type:'text',text:JSON.stringify({name,args})}],structuredContent:{revision,name,args,meta,settings:JSON.parse(fs.readFileSync(settingsPath,'utf8')),home,shared,pid:process.pid,...(name==='pebble.count'?{count:args.stones?.length??0}:{})}});
}
if(transport==='stdio') {
 readline.createInterface({input:process.stdin}).on('line',line=>{
  const response=handle(JSON.parse(line));
  if(response) process.stdout.write(JSON.stringify(response)+'\n');
 });
} else {
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET') {res.writeHead(405);return res.end();}
  if(req.method==='DELETE') {res.writeHead(200);return res.end();}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const packet=JSON.parse(Buffer.concat(chunks).toString());
  const response=handle(packet);
  if(!response) {if(packet.method==='tools/call')return;res.writeHead(202);return res.end();}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
 });
 server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'brocrew-plugin-ready',api:1,mcp:{url:'http://127.0.0.1:'+server.address().port+'/pebbles'}})+'\n'));
}
`

export function thirdPluginPackage(revision: 1 | 2, transport: ThirdPluginTransport) {
  const fields = {
    type: 'object',
    properties: {
      label: { type: 'string' },
      ...(revision === 2 ? { colour: { type: 'string' } } : {}),
    },
    additionalProperties: false,
  }
  const files = new Map<string, Buffer>([
    [
      'peer.mjs',
      Buffer.from(
        peer.replace('RELEASE', String(revision)).replace('TRANSPORT', JSON.stringify(transport)),
      ),
    ],
    ['tools.json', Buffer.from(JSON.stringify({ source: 'mcp' }))],
    [
      '.fictional settings/配置.html',
      Buffer.from(
        '<!doctype html><meta charset="utf-8"><title>Fictional pebbles</title>' +
          '<label>Label<input name="label"></label>' +
          (revision === 2 ? '<label>Colour<input name="colour"></label>' : ''),
      ),
    ],
  ])
  const manifest = {
    format: 3,
    id: thirdPluginId,
    name: 'Fictional pebble box',
    version: `${revision}.0.0`,
    description: 'Sort opaque fictional pebbles.',
    authors: ['Fictional Keeper'],
    platforms: [{ os: process.platform, cpu: process.arch }],
    minAppVersion: '1.0.0',
    permissions: { description: 'Use fictional fixture files only.' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: { kind: 'node', entry: 'peer.mjs' },
    mcp:
      transport === 'stdio'
        ? { transport: 'stdio' }
        : { transport: 'streamable-http', bootstrap: 'ready-message' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    settings: {
      page: { entry: '.fictional settings/配置.html', assets: ['.fictional settings/配置.html'] },
      fields,
    },
    lifecycle: { stop: { signal: 'SIGTERM', graceMs: 300 }, dataOnRemove: 'keep' },
    data: { schema: revision, migrateOnStart: true },
  }
  const archive = tar([
    { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return { manifest, archive, sha256: pluginSha256(archive), fields }
}
