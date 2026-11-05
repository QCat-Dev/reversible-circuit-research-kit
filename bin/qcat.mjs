#!/usr/bin/env node
import { writeFile,readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { init,prepare,submit,download,downloadTaskManifest,listVerified,pullVerified,pullBest,listReferences,pullReference,request,apiBase } from '../src/client.mjs';
import { collectRun } from '../src/run-capture.mjs';
import { reportSchema } from '../src/protocol.mjs';
import {importBaseline,buildCircuit,packSource} from '../src/build-circuit.mjs';
const [command,arg,extra]=process.argv.slice(2);
try{
  if(command==='init'&&arg){
    const flags=process.argv.slice(4);
    const options=flags.length===0?{}:flags.length===1&&flags[0]==='--empty'?{empty:true}:flags.length===2&&flags[0]==='--baseline'&&!flags[1].startsWith('--')?{baselinePath:flags[1]}:null;
    if(!options)throw new Error('Use init <new-folder> [--baseline <existing-ops.bin> | --empty].');
    const baseline=await init(arg,options);
    console.log(baseline?'Created an editable research project with a hash-checked parent '+(baseline.parentCircuitId||'(unverified)')+'. Read RESEARCH.md, then build and evaluate.':'Created an editable research project. Import a provenance-tracked baseline before building.');
  }
  else if(command==='task-manifest'&&arg){console.log(JSON.stringify(await downloadTaskManifest(arg),null,2));}
  else if(command==='import-baseline'&&arg&&extra){console.log(JSON.stringify(await importBaseline(arg,extra),null,2));}
  else if(command==='build'&&arg){console.log(JSON.stringify(await buildCircuit(arg),null,2));}
  else if(command==='pack-source'&&arg){console.log(JSON.stringify(await packSource(arg),null,2));}
  else if(command==='record'&&arg){
    const allowed=new Set(['--verifier','--verifier-version','--manifest']),flags=process.argv.slice(4),values=new Map();
    for(let i=0;i<flags.length;i+=2){const [key,value]=flags.slice(i,i+2);if(!allowed.has(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Use record <folder> --verifier <eval_circuit> --verifier-version <revision> --manifest <task-manifest.json>.');values.set(key,value);}
    if(values.size!==allowed.size)throw new Error('Provide the verifier, its exact version and downloaded task manifest.');
    if((await stat(values.get('--manifest'))).size>1048576)throw new Error('Task manifest exceeds 1 MiB.');
    const taskManifest=await readFile(values.get('--manifest')),wrapper=JSON.parse(taskManifest.toString('utf8'));
    const report=await collectRun({folder:arg,verifierPath:values.get('--verifier'),verifierVersion:values.get('--verifier-version'),taskManifest,taskManifestSha256:wrapper.manifestHash});
    reportSchema.parse(report);
    console.log('Created run-report.json and run.log from the completed execution. Author-provided evidence; independent platform verification is still required.');
  }
  else if(command==='check'&&arg){const p=await prepare(arg);await writeFile(join(arg,'qcat.submission.json'),p.canonicalBytes);console.log(JSON.stringify({status:'materials_checked',files:p.files.length,bundleHash:p.bundleHash,scientificStatus:'not_verified'},null,2));}
  else if(command==='submit'&&arg){if(extra!=='--development')throw new Error('Development intake only. Use --development to acknowledge private receipt without scientific qualification or rewards.');console.log(JSON.stringify(await submit(arg,{onProgress:name=>console.log('Stored '+name)}),null,2));}
  else if(command==='status'&&arg){if(!/^[a-f0-9-]{36}$/.test(arg))throw new Error('Use a submission UUID.');console.log(JSON.stringify(await request(apiBase(process.env.QCAT_API_URL),process.env.QCAT_API_KEY,'/submissions/'+arg+'/evidence').then(r=>r.json()),null,2));}
  else if(command==='download'&&arg&&extra){console.log('Downloaded '+await download(arg,extra));}
  else if(command==='list-references'){console.log(JSON.stringify(await listReferences(),null,2));}
  else if(command==='pull-reference'&&arg&&extra){console.log(JSON.stringify(await pullReference(arg,extra),null,2));}
  else if(command==='pull-genesis'&&arg){console.log(JSON.stringify(await pullReference('DONOR-I00-512-R255',arg),null,2));}
  else if(command==='list-verified'){console.log(JSON.stringify(await listVerified(arg||'ecc-point-addition',extra),null,2));}
  else if(command==='history-verified'){console.log(JSON.stringify(await listVerified(arg||'ecc-point-addition',extra,'latest'),null,2));}
  else if(command==='pull'&&arg&&extra){console.log(JSON.stringify(await pullVerified(arg,extra),null,2));}
  else if(command==='pull-best'&&arg){console.log(JSON.stringify(await pullBest(arg,extra||'ecc-point-addition'),null,2));}
  else{console.log('Quantum Cat research kit 0.10.4\n\ninit <new-folder> [--baseline <ops.bin> | --empty]\ntask-manifest <new-file>               Download and pin the current task definition\nlist-references                         Archived team references (API key required)\npull-genesis <new-folder>               Download the frozen starting circuit\npull-reference <id> <new-folder>        Download one archived reference\nlist-verified [task-id] [cursor]          Qualified community results, best first\nhistory-verified [task-id] [cursor]       Newest verified submissions first\npull-best <new-folder> [task-id]\npull <verified-circuit-id> <new-folder>\nimport-baseline <folder> <compiled-qeccopsz-file>\nbuild <folder>\npack-source <folder>\nrecord <folder> --verifier <eval_circuit> --verifier-version <revision> --manifest <task-manifest.json>\ncheck <folder>\nsubmit <folder> --development\nstatus <submission-id>\ndownload <submission-id> <new-folder>\n\nSet QCAT_API_KEY with circuits:read for all reference and verified-circuit list/pull; submission and private records need their own scopes.\nQCAT_API_URL defaults to http://localhost:3000/api/v1. Build facts are not scientific verification.');if(command&&command!=='--help')process.exitCode=1;}
}catch(error){console.error(error.issues?error.issues.map(x=>x.path.join('.')+': '+x.message).join('\n'):error.message);if(error.logPath)console.error('Execution log retained: '+error.logPath);process.exitCode=1;}
