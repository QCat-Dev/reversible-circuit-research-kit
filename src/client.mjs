import { readFile, writeFile, mkdir, realpath, stat, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BUNDLE_VERSION,TASK_VERSION,artifactRules,identifyArtifact,validateArtifactBytes,bindReport,bundleIdentity,sha256 } from './protocol.mjs';
import {importBaseline} from './build-circuit.mjs';
import {MAX_DELTA_BYTES,reconstructDelta} from './delta.mjs';
const templates=resolve(dirname(fileURLToPath(import.meta.url)),'../templates');
export async function init(folder,{baselinePath=null,empty=false}={}){
  if(baselinePath&&empty)throw new Error('Choose either --baseline or --empty.');
  await mkdir(folder,{recursive:false});
  for(const name of ['parameters.json','method.md','research-report.md'])await writeFile(join(folder,name),await readFile(join(templates,name)),{flag:'wx'});
  await mkdir(join(folder,'src'));await mkdir(join(folder,'baseline'));await mkdir(join(folder,'experiments'));
  for(const [source,target] of [['optimize.mjs','src/optimize.mjs'],['RESEARCH.md','RESEARCH.md'],['PROJECT-AGENTS.md','AGENTS.md'],['EXPERIMENT.md','experiments/EXPERIMENT-TEMPLATE.md']])await writeFile(join(folder,target),await readFile(join(templates,source)),{flag:'wx'});
  await writeFile(join(folder,'.gitignore'),'.qcat-run-contexts/\n.qcat-upload-state.json\nrun.log\nrun-report.json\nops.bin\nops.qdelta\nbaseline/ops.bin\nnode_modules/\n',{flag:'wx'});
  await writeFile(join(folder,'RUN-REPORT-REQUIRED.md'),'# Runtime report required\n\nPlace your actual completed machine-readable run report in run-report.json. A draft or not_run declaration cannot be submitted. See the kit guide and JSON Schema. Do not invent results.\n',{flag:'wx'});
  const project={schemaVersion:BUNDLE_VERSION,taskId:'ecc-point-addition',taskVersion:TASK_VERSION,title:'',summary:'',ai:{usage:null,models:[]},provenance:{license:'',credits:'',links:[]},sharing:'private_review',artifacts:artifactRules.filter(x=>x.required).map(x=>({role:x.role,filename:x.example}))};
  await writeFile(join(folder,'qcat.project.json'),JSON.stringify(project,null,2)+'\n',{flag:'wx'});
  if(baselinePath)return importBaseline(folder,baselinePath);
  if(empty)return null;
  const bundled=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/genesis/ops.bin');
  try { await stat(bundled); return await importBundledGenesis(folder,bundled); }
  catch(error){ if(error.code!=='ENOENT')throw error; }
}
async function importBundledGenesis(folder,path){
  const manifest=JSON.parse(await readFile(join(dirname(path),'reference-manifest.json'),'utf8'));
  if(manifest.id!=='DONOR-I00-512-R255'||manifest.circuit?.sha256!=='684bc042ca57c67192cbd5cb3f56ae415475f10d574ecc20dc1e56337909563a'||manifest.circuit.sizeBytes!==105326592)throw new Error('Bundled Genesis manifest is invalid.');
  return importBaseline(folder,path);
}
export async function prepare(folder){
  const root=await realpath(folder),project=JSON.parse(await readFile(join(root,'qcat.project.json'),'utf8'));
  if(!Array.isArray(project.artifacts)||project.artifacts.length>10)throw new Error('List at most ten materials in qcat.project.json.');
  const files=[];
  for(const item of project.artifacts){
    const {rule,encoding}=identifyArtifact(item.role,item.filename),path=join(root,item.filename);
    if(await realpath(path)!==path)throw new Error('Research materials must be regular files in the package folder, not symbolic links.');
    const info=await stat(path);if(!info.isFile()||info.size<1||info.size>rule.maxBytes)throw new Error(rule.label+' exceeds its file limit or is empty.');
    const bytes=await readFile(path),metadata=validateArtifactBytes(item.role,encoding,bytes);
    files.push({path,metadata,artifact:{role:item.role,filename:item.filename,encoding,sizeBytes:bytes.length,sha256:sha256(bytes)}});
  }
  const identity=bundleIdentity({...project,artifacts:files.map(f=>f.artifact)});
  bindReport(files.find(x=>x.artifact.role==='verification_report').metadata,identity.manifest);
  return {...identity,files};
}
export function apiBase(value){
  const u=new URL(value||'http://localhost:3000/api/v1');
  if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new Error('Use an HTTPS API URL, or HTTP on localhost, without credentials, query or fragment.');
  return u.href.replace(/\/$/,'');
}
export async function request(base,key,path,options={}){
  if(!key)throw new Error('Set QCAT_API_KEY to your scoped API key. Do not put keys in project files.');
  const response=await fetch(base+path,{...options,headers:{authorization:'Bearer '+key,...options.headers},redirect:'error',signal:options.signal||AbortSignal.timeout(180000)});
  if(!response.ok){let message='Research request failed ('+response.status+').';try{const b=await response.json();message=b.error?.message||message;if(b.error?.fields)message+=' '+Object.entries(b.error.fields).map(([k,v])=>k+': '+v).join('; ');}catch{}const e=new Error(message);e.status=response.status;throw e;}
  return response;
}
async function circuitRequest(base,path,timeout=15000){
  const key=process.env.QCAT_API_KEY;
  if(!key)throw new Error('Set QCAT_API_KEY with circuits:read permission to browse or download verified circuits.');
  const route=path.startsWith('/api/v1/')?path.slice('/api/v1'.length):path;
  return request(base,key,route,{signal:AbortSignal.timeout(timeout)});
}
export async function listVerified(taskId='ecc-point-addition',cursor,sort='best'){
  if(!/^[a-z0-9-]{1,80}$/.test(taskId))throw new Error('Use a public research task ID.');
  if(cursor&&!/^[a-f0-9-]{36}$/.test(cursor))throw new Error('Use a verified-circuit cursor UUID.');
  if(!['best','latest'].includes(sort))throw new Error('Use best or latest circuit order.');
  const query=new URLSearchParams({sort,...(cursor?{cursor}:{})});
  const base=apiBase(process.env.QCAT_API_URL),path='/challenges/'+taskId+'/verified-circuits?'+query;
  return circuitRequest(base,path).then(r=>r.json());
}
export async function pullBest(folder,taskId='ecc-point-addition'){
  if(!/^[a-z0-9-]{1,80}$/.test(taskId))throw new Error('Use a public research task ID.');
  const base=apiBase(process.env.QCAT_API_URL);
  const result=await circuitRequest(base,'/challenges/'+taskId+'/verified-circuits/best').then(r=>r.json());
  if(result.status!=='available'||!result.item?.id)throw new Error('No publicly verified circuit is available for this task yet.');
  return pullVerified(result.item.id,folder);
}
async function readVerifiedBytes(base,path,expected,maxBytes){
  if(!/^[a-f0-9]{64}$/.test(expected?.sha256||'')||!Number.isSafeInteger(expected.sizeBytes)||expected.sizeBytes<1||expected.sizeBytes>maxBytes)throw new Error('Public transfer metadata is invalid.');
  const response=await circuitRequest(base,path,900000);
  if(response.headers.get('x-content-sha256')!==expected.sha256||!response.body)throw new Error('Public file fingerprint is missing or inconsistent.');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isSafeInteger(declared)&&declared>0&&declared!==expected.sizeBytes)throw new Error('Public file length disagrees with its manifest.');
  const parts=[];let size=0;const digest=createHash('sha256');
  for await(const chunk of Readable.fromWeb(response.body)){
    size+=chunk.length;if(size>expected.sizeBytes)throw new Error('Public file exceeds its declared size.');
    digest.update(chunk);parts.push(Buffer.from(chunk));
  }
  if(size!==expected.sizeBytes||digest.digest('hex')!==expected.sha256)throw new Error('Downloaded public file did not match its SHA-256.');
  return Buffer.concat(parts,size);
}
async function verifiedPayload(base,id,visited=new Set()){
  if(!/^[a-f0-9-]{36}$/.test(id)||visited.has(id)||visited.size>=32)throw new Error('Invalid or cyclic verified circuit parent chain.');
  visited.add(id);
  const manifest=await circuitRequest(base,'/verified-circuits/'+id+'/manifest').then(r=>r.json());
  if(manifest.id!==id||manifest.verifiedStatus!=='public_verified')throw new Error('The server did not return a matching public verified circuit.');
  const hex=/^[a-f0-9]{64}$/;
  for(const role of ['circuit','source'])if(!hex.test(manifest[role]?.sha256||'')||!Number.isSafeInteger(manifest[role]?.sizeBytes)||manifest[role].sizeBytes<1||manifest[role].sizeBytes>(role==='circuit'?128:64)*1024*1024)throw new Error('Public '+role+' metadata is invalid.');
  const circuitPath='/api/v1/verified-circuits/'+id+'/files/circuit';
  const deltaPath='/api/v1/verified-circuits/'+id+'/files/delta';
  let circuit,deltaBytes=null;
  if(manifest.transport?.encoding==='qcat-delta-v1'){
    const transfer=manifest.transport;
    if(manifest.files?.delta!==deltaPath||!hex.test(transfer.parentCircuitSha256||'')||!hex.test(transfer.sha256||'')||!Number.isSafeInteger(transfer.sizeBytes)||transfer.sizeBytes<1||transfer.sizeBytes>MAX_DELTA_BYTES)throw new Error('Compact circuit transfer metadata is invalid.');
    let parent;
    const localPath=process.env.QCAT_BASELINE_PATH;
    if(localPath){
      try{const local=await readFile(localPath);if(sha256(local)===transfer.parentCircuitSha256)parent=local;}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(!parent&&/^[a-f0-9-]{36}$/.test(transfer.parentCircuitId||'')){
      const previous=await verifiedPayload(base,transfer.parentCircuitId,visited);
      parent=previous.circuit;
    }else if(!parent){
      if(!/^[A-Za-z0-9-]{3,80}$/.test(transfer.parentCircuitId||''))throw new Error('Compact circuit parent ID is invalid.');
      const bundled=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/genesis/ops.bin');
      if(transfer.parentCircuitId!=='DONOR-I00-512-R255'&&!localPath)throw new Error('Set QCAT_BASELINE_PATH to the already downloaded parent circuit.');
      try{parent=await readFile(localPath||bundled);}catch(error){if(error.code==='ENOENT')throw new Error('Download the complete Genesis kit once, or set QCAT_BASELINE_PATH to your local parent circuit.');throw error;}
    }
    if(sha256(parent)!==transfer.parentCircuitSha256)throw new Error('Local parent circuit does not match the verified manifest.');
    deltaBytes=await readVerifiedBytes(base,deltaPath,transfer,MAX_DELTA_BYTES);
    circuit=await reconstructDelta(parent,deltaBytes);
  }else if(manifest.transport?.encoding==='qeccopsz'||!manifest.transport){
    if(manifest.files?.circuit!==circuitPath)throw new Error('Public circuit link is inconsistent.');
    circuit=await readVerifiedBytes(base,circuitPath,manifest.circuit,128*1024*1024);
  }else throw new Error('Unsupported verified circuit transfer encoding.');
  if(circuit.length!==manifest.circuit.sizeBytes||sha256(circuit)!==manifest.circuit.sha256)throw new Error('Reconstructed circuit did not match the verified manifest.');
  return {manifest,circuit,deltaBytes};
}
export async function pullVerified(id,folder){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Use a verified-circuit UUID.');
  const base=apiBase(process.env.QCAT_API_URL),{manifest,circuit,deltaBytes}=await verifiedPayload(base,id);
  const sourcePath='/api/v1/verified-circuits/'+id+'/files/source';
  if(manifest.files?.source!==sourcePath)throw new Error('Public source link is inconsistent.');
  const source=await readVerifiedBytes(base,sourcePath,manifest.source,64*1024*1024);
  await mkdir(folder,{recursive:false});
  try{
    await writeFile(join(folder,'ops.bin'),circuit,{flag:'wx'});
    if(deltaBytes)await writeFile(join(folder,'ops.qdelta'),deltaBytes,{flag:'wx'});
    await writeFile(join(folder,'source.zip'),source,{flag:'wx'});
    await writeFile(join(folder,'verified-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return {id,folder,circuitSha256:manifest.circuit.sha256,sourceSha256:manifest.source.sha256,transfer:deltaBytes?'qcat-delta-v1':'qeccopsz',downloadedCircuitBytes:deltaBytes?.length??circuit.length};
  }catch(error){await rm(folder,{recursive:true,force:true});throw error;}
}
export async function submit(folder,options={}){
  const prepared=await prepare(folder),base=apiBase(options.base||process.env.QCAT_API_URL),key=options.key||process.env.QCAT_API_KEY;
  const preflight=await request(base,key,'/research/preflight',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest:prepared.manifest,runtimeReport:prepared.files.find(f=>f.artifact.role==='verification_report').metadata})}).then(r=>r.json());
  if(preflight.bundleHash!==prepared.bundleHash)throw new Error('Client and server package fingerprints disagree. Update the research kit.');
  const statePath=join(folder,'.qcat-upload-state.json');let state;
  try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Upload state is unreadable. Keep a backup and remove it before restarting.');}
  if(!state||state.bundleHash!==prepared.bundleHash||state.base!==base||state.authorId!==preflight.authorId)state={bundleHash:prepared.bundleHash,base,authorId:preflight.authorId,key:randomUUID(),uploads:{}};
  const persist=()=>writeFile(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});await persist();
  try{
    for(const {path,artifact}of prepared.files){
      let entry=state.uploads[artifact.filename];
      if(!entry){const u=await request(base,key,'/research/uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskVersion:prepared.manifest.taskVersion,artifactRole:artifact.role,filename:artifact.filename,encoding:artifact.encoding,sizeBytes:artifact.sizeBytes,sha256:artifact.sha256})}).then(r=>r.json());entry=state.uploads[artifact.filename]={uploadId:u.uploadId,uploaded:false};await persist();}
      if(!entry.uploaded){const stream=createReadStream(path);try{await request(base,key,'/research/uploads/'+entry.uploadId+'/content',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(artifact.sizeBytes)},body:stream,duplex:'half',signal:AbortSignal.timeout(900000)});}finally{stream.destroy();}entry.uploaded=true;await persist();}
      options.onProgress?.(artifact.filename);
    }
    const saved=await request(base,key,'/submissions',{method:'POST',headers:{'content-type':'application/json','idempotency-key':state.key},body:JSON.stringify({submissionFormat:'research-bundle-v1',manifest:prepared.manifest,uploads:Object.entries(state.uploads).map(([filename,u])=>({filename,uploadId:u.uploadId})),acknowledgeDevelopment:true})}).then(r=>r.json());
    state.submissionId=saved.id;await persist();return saved;
  }catch(error){if([404,410].includes(error.status)){state.uploads={};state.key=randomUUID();await persist();}throw error;}
}
export async function download(id,folder,options={}){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Use the submission UUID from your receipt.');
  const base=apiBase(options.base||process.env.QCAT_API_URL),key=options.key||process.env.QCAT_API_KEY;
  const evidence=await request(base,key,'/submissions/'+id+'/evidence').then(r=>r.json());if(!evidence.bundle)throw new Error('This legacy record has no complete research bundle.');
  await mkdir(folder,{recursive:false});
  for(const artifact of evidence.bundle.artifacts){identifyArtifact(artifact.role,artifact.filename);const response=await request(base,key,'/submissions/'+id+'/artifacts/'+artifact.id,{signal:AbortSignal.timeout(900000)});const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==artifact.sizeBytes||sha256(bytes)!==artifact.sha256)throw new Error('Downloaded file fingerprint mismatch: '+artifact.filename);await writeFile(join(folder,artifact.filename),bytes,{flag:'wx'});}
  const manifest=await request(base,key,'/submissions/'+id+'/manifest').then(r=>r.text());if(sha256(manifest)!==evidence.bundle.hash)throw new Error('Downloaded package manifest fingerprint mismatch.');await writeFile(join(folder,'qcat.submission.json'),manifest,{flag:'wx'});
  const project={...evidence.bundle.manifest,artifacts:evidence.bundle.manifest.artifacts.map(a=>({role:a.role,filename:a.filename}))};await writeFile(join(folder,'qcat.project.json'),JSON.stringify(project,null,2)+'\n',{flag:'wx'});return evidence.submission.id;
}

export async function downloadTaskManifest(path){
  const base=apiBase(process.env.QCAT_API_URL);
  const response=await fetch(base+'/challenges/ecc-point-addition/versions/'+TASK_VERSION,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Could not download the current task manifest ('+response.status+').');
  const text=await response.text();
  if(Buffer.byteLength(text)>1048576)throw new Error('Task manifest exceeds 1 MiB.');
  const wrapper=JSON.parse(text),definition=wrapper?.definition;
  if(definition?.id!=='ecc-point-addition'||definition?.taskVersion!==TASK_VERSION||wrapper.manifestHash!==sha256(JSON.stringify(definition))||wrapper.scientificPackage?.scope!=='local_and_server_precheck')throw new Error('The task manifest is not the pinned research release.');
  await writeFile(path,JSON.stringify(wrapper,null,2)+'\n',{flag:'wx'});
  return {path,taskVersion:TASK_VERSION,manifestHash:wrapper.manifestHash,releaseId:wrapper.scientificPackage.releaseId};
}
export async function listReferences(){
  const base=apiBase(process.env.QCAT_API_URL);
  return circuitRequest(base,'/reference-circuits').then(r=>r.json());
}
export async function pullReference(id,folder){
  if(!/^[A-Za-z0-9-]{3,80}$/.test(id))throw new Error('Use a published reference circuit ID.');
  const base=apiBase(process.env.QCAT_API_URL),manifest=await circuitRequest(base,'/reference-circuits/'+id+'/manifest').then(r=>r.json());
  if(manifest.id!==id||manifest.parentCircuitId!==id||manifest.currentPlatformQualification!==false)throw new Error('Reference identity or qualification status is inconsistent.');
  if(manifest.files?.circuit!=='/api/v1/reference-circuits/'+id+'/file')throw new Error('Reference file link is inconsistent.');
  const expected=manifest.circuit;
  if(!/^[a-f0-9]{64}$/.test(expected?.sha256||'')||!Number.isSafeInteger(expected.sizeBytes)||expected.sizeBytes<1||expected.sizeBytes>128*1024*1024)throw new Error('Reference metadata is invalid.');
  await mkdir(folder,{recursive:false});
  try{
    const response=await circuitRequest(base,manifest.files.circuit,900000);
    if(response.headers.get('x-content-sha256')!==expected.sha256||!response.body)throw new Error('Reference fingerprint is missing or inconsistent.');
    let bytes=0;const hash=createHash('sha256');
    const meter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>expected.sizeBytes)return done(new Error('Reference exceeds declared size.'));hash.update(chunk);done(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(join(folder,'ops.bin'),{flags:'wx'}));
    if(bytes!==expected.sizeBytes||hash.digest('hex')!==expected.sha256)throw new Error('Downloaded reference did not match its SHA-256.');
    await writeFile(join(folder,'reference-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return {id,folder,circuitSha256:expected.sha256,observedErrors:manifest.evidence.incorrectInputs,currentPlatformQualification:false};
  }catch(error){await rm(folder,{recursive:true,force:true});throw error;}
}
