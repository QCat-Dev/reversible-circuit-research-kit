import {createReadStream, createWriteStream} from 'node:fs';
import {readFile, writeFile, mkdir, stat, rename, rm, copyFile, open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createZstdCompress, createZstdDecompress} from 'node:zlib';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join, resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DeltaRecorder,ORIGIN,fixedChunks,reconstructDelta} from './delta.mjs';
import {TASK_VERSION} from './protocol.mjs';

const MAGIC='QECCOPSZ', RECORD_BYTES=56, MAX_OPS=40_000_000, MAX_BYTES=128*1024*1024;
const MAX_OUTPUT_OPS=40_000_000, MAX_OUTPUT_BYTES=128*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function inspect(path){
  const info=await stat(path);
  if(!info.isFile()||info.size<17||info.size>MAX_BYTES)throw new Error('Expected a regular QECCOPSZ reference between 17 bytes and 128 MiB.');
  const file=await open(path,'r');
  try{
    const header=Buffer.alloc(16);await file.read(header,0,16,0);
    if(header.subarray(0,8).toString()!==MAGIC)throw new Error('Invalid QECCOPSZ magic.');
    const count=header.readBigUInt64LE(8);
    if(count<1n||count>BigInt(MAX_OPS))throw new Error('Circuit operation count is outside evaluator limits.');
    return {count:Number(count),size:info.size};
  }finally{await file.close();}
}

export async function importBaseline(folder,source){
  const root=resolve(folder),input=resolve(source),target=join(root,'baseline','ops.bin');
  if(input===target)throw new Error('Baseline is already at the project destination.');
  const shape=await inspect(input);
  const hash=digest(await readFile(input));
  const parentDir=resolve(input,'..');
  const candidates=[];
  for(const name of ['reference-manifest.json','verified-manifest.json']){
    try{candidates.push({name,item:JSON.parse(await readFile(join(parentDir,name),'utf8'))});}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(candidates.length>1)throw new Error('Choose a baseline folder with one unambiguous circuit manifest.');
  let parent=null;
  if(candidates.length){
    const {name,item}=candidates[0];
    if(item.circuit?.sha256!==hash||item.circuit?.sizeBytes!==shape.size)throw new Error('The downloaded parent manifest does not match this circuit.');
    if(name==='reference-manifest.json'){
      if(item.currentPlatformQualification!==false||item.parentCircuitId!==item.id||!item.id)throw new Error('Archived reference manifest is invalid.');
      parent={id:item.id,qualification:'archived_reference_not_platform_qualified',manifestFile:name,evidence:item.evidence};
    }else{
      if(item.verifiedStatus!=='public_verified'||item.taskVersion!==TASK_VERSION||!item.id||!/^[a-f0-9-]{36}$/.test(item.id))throw new Error('Verified circuit manifest is invalid for this task.');
      parent={id:item.id,qualification:'public_verified',manifestFile:name,verifiedAt:item.verifiedAt,score:item.score,author:item.author};
    }
  }
  await mkdir(join(root,'baseline'),{recursive:true});
  await copyFile(input,target,1); // COPYFILE_EXCL: preserve the chosen reference.
  if(digest(await readFile(target))!==hash){await rm(target,{force:true});throw new Error('Baseline copy changed during import.');}
  const provenance={sourceFile:basename(input),sha256:hash,operations:shape.count,importedAt:new Date().toISOString(),qualification:parent?.qualification||'unverified',...(parent?{parentCircuitId:parent.id,manifestFile:parent.manifestFile,...(parent.evidence?{evidence:parent.evidence}:{}),...(parent.verifiedAt?{verifiedAt:parent.verifiedAt}:{}),...(parent.score?{verifiedScore:parent.score}:{})}:{})};
  await writeFile(join(root,'baseline','provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
  if(parent){const projectPath=join(root,'qcat.project.json'),project=JSON.parse(await readFile(projectPath,'utf8'));project.parentCircuitId=parent.id;project.parentCircuitSha256=hash;await writeFile(projectPath,JSON.stringify(project,null,2)+'\n');}
  return {baseline:target,sha256:hash,operations:shape.count,qualification:provenance.qualification,parentCircuitId:parent?.id||null};
}

export async function buildCircuit(folder){
  const root=resolve(folder),baseline=join(root,'baseline','ops.bin'),output=join(root,'ops.bin');
  const shape=await inspect(baseline);
  for(const name of ['run-report.json','run.log','ops.qdelta']){
    try{await stat(join(root,name));throw new Error('Archive '+name+' and the previous circuit before building a new candidate. Keep .qcat-run-contexts.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  try{await stat(output);throw new Error('Archive the previous ops.bin before building another candidate.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const source=join(root,'src','optimize.mjs'),sourceBytes=await readFile(source);
  const module=await import(pathToFileURL(source).href+'?sha256='+digest(sourceBytes));
  if(typeof module.transform!=='function')throw new Error('src/optimize.mjs must export transform(records).');
  const sourceHash=digest(sourceBytes),baselineBytes=await readFile(baseline),baselineHash=digest(baselineBytes),recorder=new DeltaRecorder();
  const temporary=join(root,'.qcat-build-'+process.pid+'-'+Date.now());
  const compressed=temporary+'.zst';let inputCount=0,outputCount=0;
  async function* decodedRecords(){
    const decoded=createReadStream(baseline,{start:16}).pipe(createZstdDecompress());
    let carry=Buffer.alloc(0);
    for await(const chunk of decoded){
      const bytes=carry.length?Buffer.concat([carry,chunk]):chunk;
      const usable=bytes.length-bytes.length%RECORD_BYTES;
      for(let offset=0;offset<usable;offset+=RECORD_BYTES){
        const record=Buffer.from(bytes.subarray(offset,offset+RECORD_BYTES));
        if(record.readUInt32LE(0)>17)throw new Error('Unknown operation kind in baseline.');
        if(++inputCount>shape.count)throw new Error('Decoded records exceed QECCOPSZ header.');
        record[ORIGIN]=inputCount-1;yield record;
      }
      carry=Buffer.from(bytes.subarray(usable));
    }
    if(carry.length||inputCount!==shape.count)throw new Error('Decoded record count does not match QECCOPSZ header.');
  }
  async function* optimized(){
    for await(const candidate of module.transform(decodedRecords())){
      if(!(candidate instanceof Uint8Array)||candidate.length!==RECORD_BYTES)throw new Error('Optimizer must emit 56-byte operation records.');
      const record=Buffer.isBuffer(candidate)?candidate:Buffer.from(candidate);
      if(record.readUInt32LE(0)>17)throw new Error('Optimizer emitted an unknown operation kind.');
      if(++outputCount>MAX_OUTPUT_OPS)throw new Error('Candidate output exceeded the 40-million-operation evaluator limit.');
      recorder.observe(record);yield record;
    }
    if(inputCount!==shape.count)throw new Error('Optimizer must consume the entire baseline record stream.');
    if(!outputCount)throw new Error('An empty circuit is not accepted.');
  }
  try{
    await pipeline(Readable.from(fixedChunks(optimized())),createZstdCompress({level:3}),createWriteStream(compressed,{flags:'wx'}));
    const header=Buffer.alloc(16);header.write(MAGIC,0,'ascii');header.writeBigUInt64LE(BigInt(outputCount),8);
    await pipeline(Readable.from([header]),createWriteStream(temporary,{flags:'wx'}));
    await pipeline(createReadStream(compressed),createWriteStream(temporary,{flags:'a'}));
    if((await stat(temporary)).size>MAX_OUTPUT_BYTES)throw new Error('Built candidate exceeds the 128 MiB upload and evaluator limit.');
    if(digest(await readFile(baseline))!==baselineHash)throw new Error('Baseline changed during build.');
    if(digest(await readFile(source))!==sourceHash)throw new Error('Optimization source changed during build.');
    await rename(temporary,output);
    const circuitHash=digest(await readFile(output)),outputBytes=(await stat(output)).size;
    const projectPath=join(root,'qcat.project.json'),project=JSON.parse(await readFile(projectPath,'utf8'));
    let delivery={mode:'full_circuit',bytes:outputBytes};
    if(project.parentCircuitId&&project.parentCircuitSha256===baselineHash){
      const delta=recorder.finish({parentSha256:baselineHash,circuitSha256:circuitHash,parentOperations:inputCount,outputOperations:outputCount,circuitBytes:outputBytes});
      if(delta&&delta.length<outputBytes/2){
        try{
          const rebuilt=await reconstructDelta(baselineBytes,delta);
          if(digest(rebuilt)!==circuitHash)throw new Error('Delta reconstruction mismatch.');
          await writeFile(join(root,'ops.qdelta'),delta,{flag:'wx'});
          delivery={mode:'qcat-delta-v1',bytes:delta.length,sha256:digest(delta)};
          project.compiledCircuitSha256=circuitHash;project.compiledCircuitSizeBytes=outputBytes;
          const circuit=project.artifacts.find(item=>item.role==='circuit');
          if(circuit)circuit.filename='ops.qdelta';
        }catch(error){await rm(join(root,'ops.qdelta'),{force:true});delivery={mode:'full_circuit',bytes:outputBytes,deltaRejection:(error).message};}
      }
    }
    if(delivery.mode==='full_circuit'){
      delete project.compiledCircuitSha256;delete project.compiledCircuitSizeBytes;
      const circuit=project.artifacts.find(item=>item.role==='circuit');if(circuit)circuit.filename='ops.bin';
    }
    const receipt={schemaVersion:'qcat-local-build-v2',createdAt:new Date().toISOString(),baselineSha256:baselineHash,optimizerSha256:sourceHash,circuitSha256:circuitHash,inputOperations:inputCount,outputOperations:outputCount,netOperationsRemoved:inputCount-outputCount,delivery,scientificStatus:'not_checked'};
    await writeFile(join(root,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    const params=JSON.parse(await readFile(join(root,'parameters.json'),'utf8'));
    if(!params||Array.isArray(params)||typeof params!=='object')throw new Error('parameters.json must be an object.');
    params.build={baselineSha256:baselineHash,optimizerSha256:sourceHash,circuitSha256:circuitHash,inputOperations:inputCount,outputOperations:outputCount,delivery};
    await writeFile(join(root,'parameters.json'),JSON.stringify(params,null,2)+'\n');
    await writeFile(projectPath,JSON.stringify(project,null,2)+'\n');
    return receipt;
  }finally{await rm(temporary,{force:true});await rm(compressed,{force:true});}
}

export async function packSource(folder){
  const root=resolve(folder),names=['src/optimize.mjs','RESEARCH.md','AGENTS.md','method.md','baseline/provenance.json','build-receipt.json'];
  for(const name of names)if(!(await stat(join(root,name))).isFile())throw new Error('Missing reproduction file: '+name);
  const archive=join(root,'source.zip');
  try{await stat(archive);throw new Error('Archive the previous source.zip before packaging changed source.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  execFileSync('zip',['-q',archive,...names],{cwd:root});
  const projectPath=join(root,'qcat.project.json'),project=JSON.parse(await readFile(projectPath,'utf8'));
  if(!project.artifacts.some(item=>item.role==='source'))project.artifacts.push({role:'source',filename:'source.zip'});
  await writeFile(projectPath,JSON.stringify(project,null,2)+'\n');
  return {sourceArchive:archive,sha256:digest(await readFile(archive)),files:names};
}
