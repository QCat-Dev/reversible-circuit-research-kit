import { z } from 'zod';
import { createHash } from 'node:crypto';
import {inspectDelta,MAX_DELTA_BYTES} from './delta.mjs';
export const KIT_VERSION = '0.10.4';
export const BUNDLE_VERSION = 'qcat-research-bundle-v1';
export const TASK_VERSION = 'ecc-random-v2';
export const SAMPLING_POLICY = 'qcat-ecc-random-10048-v1';
export const RANDOM_INPUTS = 10048;
export const BATCH_SIZE = 64;
export const RANDOM_BATCHES = RANDOM_INPUTS / BATCH_SIZE;
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
export const artifactRules = [
  {role:'circuit',label:'Compiled circuit',required:true,maxCount:1,maxBytes:134217728,formats:{'.bin':'qeccopsz','.qdelta':'qcat-delta-v1'},example:'ops.bin',guide:'Upload the compact .qdelta when the kit can reproduce it from a named parent. The server reconstructs the exact compiled QECCOPSZ circuit before verification. Otherwise upload ops.bin. Deltas are limited to 16 MiB.'},
  {role:'parameters',label:'Circuit parameters',required:true,maxCount:1,maxBytes:1048576,formats:{'.json':'json'},example:'parameters.json',template:'parameters.json',guide:'Record the exact build and circuit parameters. Use an explicit empty object only when the circuit has no configurable parameters.'},
  {role:'description',label:'Method & reproduction',required:true,maxCount:1,maxBytes:2097152,formats:{'.md':'markdown'},example:'method.md',template:'method.md',guide:'Explain what changed, why it should preserve the computation, and how to reproduce the build. Include commands, dependencies and environment versions.'},
  {role:'research_report',label:'Research report',required:true,maxCount:1,maxBytes:16777216,formats:{'.md':'markdown','.pdf':'pdf'},example:'research-report.md',template:'research-report.md',guide:'Describe your results, resource analysis, evidence and limitations. Distinguish measurements from expectations and cite prior work.'},
  {role:'verification_report',label:'Runtime report',required:true,maxCount:1,maxBytes:1048576,formats:{'.json':'json'},example:'run-report.json',template:'run-report.schema.json',guide:'Required machine-readable JSON from completed runs. It must identify this circuit, its parameters, the task and verifier versions, timing, checks and measured resource costs. A draft, not_run status or narrative report cannot replace it.'},
  {role:'run_log',label:'Runtime log',required:true,maxCount:1,maxBytes:8388608,formats:{'.log':'text'},example:'run.log',guide:'The original evaluator output captured alongside run-report.json. The report must contain this exact log’s SHA-256. The kit records both files together.'},
  {role:'source',label:'Reproduction source',required:false,maxCount:1,maxBytes:67108864,formats:{'.zip':'zip'},example:'source.zip',guide:'Optional source archive for reproducing the circuit. Exclude credentials, environments and dependencies. Archives are stored, not executed or unpacked.'},
  {role:'supporting',label:'Supporting material',required:false,maxCount:3,maxBytes:16777216,formats:{'.md':'markdown','.pdf':'pdf','.json':'json'},example:'additional-analysis.pdf',guide:'Optional additional analysis, model configuration or figures in a report. AI model names and versions belong in the model declaration, not a weights upload.'},
];
export const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const filename = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
const txt=(min,max)=>z.string().trim().min(min).max(max);
export const artifactSchema=z.object({role:z.enum(artifactRules.map(r=>r.role)),filename,encoding:z.enum(['qeccopsz','qcat-delta-v1','json','markdown','pdf','zip','text']),sizeBytes:z.number().int().min(1).max(134217728),sha256:hex}).strict();
export const aiSchema=z.discriminatedUnion('usage',[
  z.object({usage:z.literal('none'),models:z.array(z.never()).max(0)}).strict(),
  z.object({usage:z.literal('used'),models:z.array(z.object({name:txt(1,120),version:txt(1,120),purpose:txt(3,500)}).strict()).min(1).max(6)}).strict(),
]);
export const bundleSchema=z.object({
  schemaVersion:z.literal(BUNDLE_VERSION),taskId:z.literal('ecc-point-addition'),taskVersion:z.literal(TASK_VERSION),
  title:txt(3,120),summary:txt(20,1200),ai:aiSchema,
  parentCircuitId:z.string().regex(/^(?:[A-Za-z0-9-]{3,80}|[a-f0-9-]{36})$/).optional(),parentCircuitSha256:hex.optional(),
  compiledCircuitSha256:hex.optional(),compiledCircuitSizeBytes:z.number().int().min(17).max(134217728).optional(),
  provenance:z.object({license:txt(2,120),credits:txt(10,2000),links:z.array(z.string().url().max(600).regex(/^https:\/\//)).max(6)}).strict(),
  sharing:z.enum(['private_review','publish_after_qualification']),
  artifacts:z.array(artifactSchema).min(6).max(10),
}).strict().superRefine((value,ctx)=>{
  const issue=(path,message)=>ctx.addIssue({code:'custom',path,message});
  if(Boolean(value.parentCircuitId)!==Boolean(value.parentCircuitSha256))issue(['parentCircuitId'],'Provide both parentCircuitId and parentCircuitSha256, or neither.');
  const circuit=value.artifacts.find(a=>a.role==='circuit');
  if(circuit?.encoding==='qcat-delta-v1'){
    if(!value.parentCircuitId||!value.parentCircuitSha256||!value.compiledCircuitSha256||!value.compiledCircuitSizeBytes)issue(['artifacts'],'A compact delta needs a pinned parent and the exact compiled circuit hash and size.');
    if(circuit.sizeBytes>MAX_DELTA_BYTES)issue(['artifacts'],'A compact delta may contain at most 16 MiB.');
  }else if(value.compiledCircuitSha256||value.compiledCircuitSizeBytes)issue(['compiledCircuitSha256'],'Compiled circuit fields belong only to a compact delta.');
  const names=new Set();let bytes=0;
  for(const [i,a] of value.artifacts.entries()){
    const rule=artifactRules.find(r=>r.role===a.role); const ext='.'+a.filename.split('.').at(-1).toLowerCase();
    if(rule.formats[ext]!==a.encoding)issue(['artifacts',i,'encoding'],`${rule.label}: use ${Object.keys(rule.formats).join(' or ')}.`);
    if(a.sizeBytes>rule.maxBytes)issue(['artifacts',i,'sizeBytes'],`${rule.label} exceeds its ${rule.maxBytes} byte limit.`);
    if(names.has(a.filename.toLowerCase()))issue(['artifacts',i,'filename'],'Every filename in a package must be unique, ignoring case.');
    names.add(a.filename.toLowerCase());bytes+=a.sizeBytes;
  }
  for(const r of artifactRules){const count=value.artifacts.filter(a=>a.role===r.role).length;if(count<(r.required?1:0)||count>r.maxCount)issue(['artifacts'],`${r.label}: ${r.required?'required; ':''}at most ${r.maxCount} file(s).`);}
  if(bytes>MAX_BUNDLE_BYTES)issue(['artifacts'],'A research package may contain at most 256 MiB.');
});
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const integer=z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(value=>BigInt(value)<=(1n<<64n)-1n,'Value exceeds uint64.');
const inputCount=count.max(RANDOM_INPUTS),batchCount=count.max(RANDOM_BATCHES);
export const failureDetailsSchema=z.object({encoding:z.literal('index-error-mask-v1'),inputs:z.array(z.tuple([count.max(RANDOM_INPUTS-1),z.number().int().min(1).max(7)])).max(RANDOM_INPUTS)}).strict();
const errorShape={incorrectInputs:inputCount,classicalMismatchInputs:inputCount,phaseErrorInputs:inputCount,workspaceErrorInputs:inputCount,phaseErrorBatches:batchCount,workspaceErrorBatches:batchCount};
const resourceShape={qubits:integer,totalExecutedToffoli:integer,roundedMeanExecutedToffoli:integer,tGates:z.null(),score:integer};
const samplingShape={seed:hex,inputDigest:hex,inputDigestAlgorithm:z.literal('sha3-256')};
const issueAt=(ctx,path,message)=>ctx.addIssue({code:'custom',path,message});
function checkErrorEvidence(executed,errors,details,ctx,prefix){
  let prior=-1,classical=0,phase=0,workspace=0;const phaseBatches=new Set(),workspaceBatches=new Set();
  for(const [index,mask] of details.inputs){
    if(index<=prior||index>=executed)issueAt(ctx,['failureDetails','inputs'],'Failed input indices must be ordered, unique and actually executed.');
    prior=index;
    if(mask&1)classical++;
    if(mask&2){phase++;phaseBatches.add(Math.floor(index/BATCH_SIZE));}
    if(mask&4){workspace++;workspaceBatches.add(Math.floor(index/BATCH_SIZE));}
  }
  const expected={incorrectInputs:details.inputs.length,classicalMismatchInputs:classical,phaseErrorInputs:phase,workspaceErrorInputs:workspace,phaseErrorBatches:phaseBatches.size,workspaceErrorBatches:workspaceBatches.size};
  for(const [key,value]of Object.entries(errors)){
    if(value===null){if(executed!==0||details.inputs.length!==0)issueAt(ctx,[prefix,key],'Executed checks require actual stage counts.');}
    else if(value!==expected[key])issueAt(ctx,[prefix,key],'Error counts must equal the recorded input union and per-stage masks.');
  }
}
function checkResources(resources,executed,ctx,required=false){
  if(required&&Object.entries(resources).some(([k,v])=>k!=='tGates'&&v===null))issueAt(ctx,['resources'],'A completed run requires all measured resource fields.');
  if(resources.qubits===null||resources.totalExecutedToffoli===null||resources.roundedMeanExecutedToffoli===null||resources.score===null)return;
  const q=BigInt(resources.qubits),total=BigInt(resources.totalExecutedToffoli),rounded=BigInt(resources.roundedMeanExecutedToffoli),score=BigInt(resources.score),max=(1n<<64n)-1n;
  if(q<1n||total>BigInt(Number.MAX_SAFE_INTEGER))issueAt(ctx,['resources'],'Resource counts exceed the supported exact reporting range.');
  else if(executed>0){
    const expected=BigInt(Math.round(Number(total)/executed)),product=q*expected;
    if(rounded!==expected)issueAt(ctx,['resources','roundedMeanExecutedToffoli'],'Rounded mean must match the measured total and actual executed inputs.');
    if(score!==(product>max?max:product))issueAt(ctx,['resources','score'],'Score must equal qubits × rounded mean executed Toffoli, saturating at uint64.');
  }else if(required)issueAt(ctx,['resources'],'A completed score requires executed inputs.');
}
export const nativeResultSchema=z.object({
  schemaVersion:z.literal('qcat-server-result-v2'),taskVersion:z.literal(TASK_VERSION),policy:z.literal(SAMPLING_POLICY),
  status:z.enum(['passed','failed','rejected','error']),stage:z.enum(['load','layout','testing','completed']),
  coverage:z.object({requestedInputs:z.literal(RANDOM_INPUTS),eligibleInputs:inputCount.nullable(),executedInputs:inputCount,executedBatches:batchCount,complete:z.boolean()}).strict(),
  errors:z.object(Object.fromEntries(Object.entries(errorShape).map(([k,v])=>[k,v.nullable()]))).strict(),
  resources:z.object({opCount:integer.nullable(),...Object.fromEntries(Object.entries(resourceShape).map(([k,v])=>[k,k==='tGates'?v:v.nullable()])),totalExecutedClifford:integer.nullable()}).strict(),
  sampling:z.object({...samplingShape,inputDigest:hex.nullable()}).strict().nullable(),
  failure:z.object({code:z.string().regex(/^[a-zA-Z0-9_]{1,80}$/),details:z.null()}).strict().nullable(),
  failureDetails:failureDetailsSchema,
}).strict().superRefine((v,ctx)=>{
  const c=v.coverage,e=v.errors,complete=c.eligibleInputs===RANDOM_INPUTS&&c.executedInputs===RANDOM_INPUTS&&c.executedBatches===RANDOM_BATCHES;
  if(c.complete!==complete||c.executedBatches!==Math.ceil(c.executedInputs/BATCH_SIZE)||(c.eligibleInputs!==null&&c.eligibleInputs<c.executedInputs))issueAt(ctx,['coverage'],'Coverage must match the actual inputs and 64-input batches.');
  checkErrorEvidence(c.executedInputs,e,v.failureDetails,ctx,'errors');
  checkResources(v.resources,c.executedInputs,ctx,v.status==='passed');
  if(v.status==='passed'){
    if(!complete||v.stage!=='completed'||v.failure||!v.sampling?.inputDigest||v.resources.opCount==='0'||e.incorrectInputs===null||e.incorrectInputs>1)issueAt(ctx,['status'],'A pass requires all 10,048 random inputs, at most one incorrect input and complete sampling evidence.');
  }else{
    if(!v.failure)issueAt(ctx,['failure'],'An unsuccessful execution requires its actual failure code.');
    if(v.status==='rejected'&&c.executedInputs!==0)issueAt(ctx,['status'],'Structural rejection cannot include executed scientific inputs.');
    if(v.status==='failed'&&complete&&e.incorrectInputs!==null&&e.incorrectInputs<=1)issueAt(ctx,['status'],'A complete run within the one-input error threshold cannot be labelled a scientific failure.');
  }
});
export function validateNativeResult(value,expectedSeed){
  const parsed=nativeResultSchema.parse(value);
  if(expectedSeed!==undefined&&(!hex.safeParse(expectedSeed).success||(parsed.sampling?.seed!==expectedSeed&&parsed.status==='passed')||(parsed.sampling&&parsed.sampling.seed!==expectedSeed)))throw new Error('Native result sampling seed does not match the frozen context.');
  return parsed;
}
export const reportSchema=z.object({
  schemaVersion:z.literal('qcat-run-report-v2'),status:z.literal('completed'),taskVersion:z.literal(TASK_VERSION),
  taskManifestSha256:hex,circuitSha256:hex,parametersSha256:hex,
  verifier:z.object({name:txt(1,120),version:txt(1,120),buildSha256:hex}).strict(),
  run:z.object({startedAt:z.string().datetime().max(40),finishedAt:z.string().datetime().max(40),durationMs:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),exitCode:z.literal(0)}).strict(),
  sampling:z.object({policy:z.literal(SAMPLING_POLICY),...samplingShape}).strict(),
  checks:z.object({requestedInputs:z.literal(RANDOM_INPUTS),executedInputs:z.literal(RANDOM_INPUTS),executedBatches:z.literal(RANDOM_BATCHES),...errorShape,incorrectInputs:z.number().int().min(0).max(1)}).strict(),
  failureDetails:failureDetailsSchema,
  resources:z.object(resourceShape).strict(),logSha256:hex,
}).strict().superRefine((v,ctx)=>{
  if(Date.parse(v.run.finishedAt)<=Date.parse(v.run.startedAt))issueAt(ctx,['run','finishedAt'],'Finish time must be after start time.');
  const elapsed=Date.parse(v.run.finishedAt)-Date.parse(v.run.startedAt);
  if(Math.abs(elapsed-v.run.durationMs)>1000)issueAt(ctx,['run','durationMs'],'Run duration must agree with the recorded interval.');
  const {requestedInputs,executedInputs,executedBatches,...errors}=v.checks;
  checkErrorEvidence(executedInputs,errors,v.failureDetails,ctx,'checks');
  checkResources(v.resources,executedInputs,ctx,true);
});
export function canonicalJson(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
}
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function normalizeBundle(input){const parsed=bundleSchema.parse(input);parsed.artifacts.sort((a,b)=>(a.role+'\0'+a.filename)<(b.role+'\0'+b.filename)?-1:1);return parsed;}
export function bundleIdentity(input){const manifest=normalizeBundle(input),bytes=canonicalJson(manifest);if(Buffer.byteLength(bytes)>12000)throw new Error('Package metadata exceeds 12,000 bytes. Shorten descriptions or move detail into your report.');return {manifest,bundleHash:sha256(bytes),canonicalBytes:bytes};}
export function identifyArtifact(role,name){const rule=artifactRules.find(r=>r.role===role);const encoding=rule?.formats['.'+name.split('.').at(-1).toLowerCase()];if(!rule||!encoding||!filename.safeParse(name).success)throw new Error('Choose a supported file with a simple filename of at most 120 characters.');return {rule,encoding};}
export function validateArtifactBytes(role,encoding,bytes){
  const header=bytes.subarray(0,20);
  if(encoding==='qcat-delta-v1')return inspectDelta(bytes);
  if(encoding==='qeccopsz'&&(bytes.length<=20||!header.subarray(0,8).equals(Buffer.from('QECCOPSZ'))||header.readBigUInt64LE(8)===0n||!header.subarray(16,20).equals(Buffer.from([0x28,0xb5,0x2f,0xfd]))))throw new Error('Choose a compiled QECCOPSZ .bin circuit. Renaming a file does not compile it.');
  if(encoding==='pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('The report does not have a PDF header.');
  if(encoding==='zip'&&!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw new Error('The source archive does not have a ZIP header.');
  if(!['json','markdown','text'].includes(encoding))return null;
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw new Error('Text files must not contain NUL bytes.');
  if(encoding==='text'){if(text.trim().length<20)throw new Error('Provide the original evaluator runtime log.');return null;}
  if(encoding==='markdown'){if(text.includes('TODO_RESEARCH'))throw new Error('Replace the research template prompts with your actual method or report.');if(text.trim().length<40)throw new Error('Add a meaningful method or research report (at least 40 characters).');return null;}
  const parsed=JSON.parse(text);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Use a JSON object for this material.');
  const visit=(v,depth=0)=>{if(depth>16)throw new Error('JSON nesting exceeds 16 levels.');if(typeof v==='number'&&!Number.isFinite(v))throw new Error('JSON numbers must be finite.');if(v&&typeof v==='object')for(const item of Object.values(v))visit(item,depth+1);};visit(parsed);
  return role==='verification_report'?reportSchema.parse(parsed):parsed;
}
export function bindReport(report,manifest){
  const parsed=reportSchema.parse(report);const circuit=manifest.artifacts.find(a=>a.role==='circuit');
  if(parsed.circuitSha256!==(circuit.encoding==='qcat-delta-v1'?manifest.compiledCircuitSha256:circuit.sha256)||parsed.parametersSha256!==manifest.artifacts.find(a=>a.role==='parameters').sha256||parsed.taskVersion!==manifest.taskVersion||parsed.logSha256!==manifest.artifacts.find(a=>a.role==='run_log').sha256)throw new Error('The local verification report belongs to a different circuit, parameter file, runtime log or task version.');
  return parsed;
}
export function submissionSpec(){return {kitVersion:KIT_VERSION,schemaVersion:BUNDLE_VERSION,taskVersion:TASK_VERSION,canonicalization:'qcat-sorted-json-v1',bundleHashAlgorithm:'sha256',maxBundleBytes:MAX_BUNDLE_BYTES,artifactRules,aiGuidance:'Declare the exact AI model names, versions and purposes, or explicitly declare no AI assistance. Model weights are not required.',schema:z.toJSONSchema(bundleSchema,{target:'draft-07'}),reportSchema:z.toJSONSchema(reportSchema,{target:'draft-07'}),kitPath:'/downloads/qcat-research-kit.zip',guidePath:'/downloads/qcat-research-guide.md'};}
