export const pluginNodeHostServerSource = String.raw`
import http from 'node:http'; import fs from 'node:fs'; import {spawn} from 'node:child_process';
const home = process.env.BROCREW_CHROME_DATA;
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));
const server = http.createServer((req, res) => {
 const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken;
 if (req.headers.authorization !== 'Bearer '+token) { res.writeHead(401).end(); return }
 res.setHeader('content-type','application/json');
 if (req.url === '/mcp') {
  if(req.method !== 'POST') return res.writeHead(405).end();
  let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
   const packet=JSON.parse(body);
   if(packet.id===undefined)return res.writeHead(202).end();
   res.end(JSON.stringify({jsonrpc:'2.0',id:packet.id,result:{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-host',version:'1.0.0'},capabilities:{}}}));
  }); return;
 }

 if (req.url === '/healthz') return res.end(JSON.stringify({ok:true, version:'1.0.0'}));
 if (req.url === '/v1/profiles') return res.end(JSON.stringify({profiles:[]}));
 if (req.url === '/v1/launch') {
  const child = spawn(process.env.BROCREW_CHROME_EXECUTABLE, ['--user-data-dir='+home], {detached:true, stdio:'ignore'});
  res.end(JSON.stringify({pid:child.pid})); return;
 }
 if (req.url === '/v1/owner') return res.end(JSON.stringify({pid:process.ppid}));
 if (req.url === '/v1/env') return res.end(JSON.stringify({home, exec:process.execPath, pid:process.pid, inherited:process.env.FICTIONAL_HOST_MARKER}));
 if (req.url === '/v1/shared') return res.end(JSON.stringify(Object.fromEntries(['BROCREW_CHROME_SHARED','BROCREW_PLUGIN_OWNER_ID','BROCREW_PLUGIN_OWNER_LABEL','BROCREW_CHROME_MIGRATION_QUALIFICATION'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))));
 res.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:server.address().port}));
process.on('SIGTERM',()=>{});
`
