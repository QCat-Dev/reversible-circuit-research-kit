import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { TASK_VERSION, SAMPLING_POLICY, RANDOM_INPUTS, validateNativeResult, reportSchema } from './protocol.mjs';

export const MAX_LOG_BYTES = 8 * 1024 * 1024;
export const MAX_RUN_MS = 2 * 60 * 60 * 1000;
export const MAX_CIRCUIT_BYTES = 128 * 1024 * 1024;
const CAPTURE_BYTES = MAX_LOG_BYTES - 32 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RESULT_BYTES = 128 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class RunCaptureError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'RunCaptureError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new RunCaptureError(code, message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read the versioned native result, never infer scientific counts from stdout. */
export function parseEvaluatorResult(raw, expectedSeed) {
  try {
    const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
    if(bytes.length===0||bytes.length>MAX_RESULT_BYTES)reject('INVALID_OUTPUT','Native result exceeds its reporting limit.');
    const parsed=validateNativeResult(JSON.parse(utf8.decode(bytes)),expectedSeed);
    if(parsed.status!=='passed')reject('CHECKS_FAILED','The completed precheck did not meet the 10,048-input acceptance rule.');
    return parsed;
  }catch(error){
    if(error instanceof RunCaptureError)throw error;
    reject('INVALID_OUTPUT','The native result is missing, invalid, inconsistent, or bound to a different sampling context.');
  }
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    reject('INVALID_OPTIONS', 'collectRun requires an options object.');
  }
  const allowed = new Set(['folder', 'verifierPath', 'verifierVersion', 'taskManifest', 'taskManifestSha256']);
  if (Reflect.ownKeys(options).some((key) => !allowed.has(key))) {
    reject('INVALID_OPTIONS', 'Unsupported option; input, seed, environment, and argument overrides are not accepted.');
  }
  for (const key of ['folder', 'verifierPath', 'verifierVersion']) {
    if (typeof options[key] !== 'string' || !options[key].trim() || /[\x00-\x1f\x7f]/.test(options[key])) {
      reject('INVALID_OPTIONS', `${key} must be a nonempty string without control characters.`);
    }
  }
  const verifierVersion = options.verifierVersion.trim();
  if (verifierVersion.length > 120) reject('INVALID_OPTIONS', 'Verifier version must be at most 120 characters.');
  if (!SHA256.test(options.taskManifestSha256 ?? '')) reject('INVALID_MANIFEST', 'Expected a lowercase SHA-256 task manifest digest.');
  if (!(typeof options.taskManifest === 'string' || Buffer.isBuffer(options.taskManifest))) {
    reject('INVALID_MANIFEST', 'taskManifest must be the downloaded JSON wrapper as UTF-8 bytes or text.');
  }
  const bytes = Buffer.from(options.taskManifest);
  if (bytes.length > MAX_METADATA_BYTES) reject('INVALID_MANIFEST', 'Task manifest is too large.');
  let manifest;
  try { manifest = JSON.parse(utf8.decode(bytes)); } catch {
    reject('INVALID_MANIFEST', 'Task manifest must be valid UTF-8 JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || !manifest.definition || typeof manifest.definition !== 'object' || Array.isArray(manifest.definition)
      || manifest.definition.taskVersion !== TASK_VERSION) {
    reject('INVALID_MANIFEST', `Task definition must declare ${TASK_VERSION}.`);
  }
  const digest = sha256(Buffer.from(JSON.stringify(manifest.definition), 'utf8'));
  if (manifest.manifestHash !== digest || options.taskManifestSha256 !== digest) {
    reject('INVALID_MANIFEST', 'Task definition, manifestHash, and taskManifestSha256 do not agree.');
  }
  if (process.platform === 'win32') {
    reject('UNSUPPORTED_PLATFORM', 'This capture adapter requires POSIX process-group termination.');
  }
  return { ...options, verifierVersion, taskManifestSha256: digest };
}

async function openRegular(path, maxBytes = Number.MAX_SAFE_INTEGER) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      reject('INVALID_FILE', 'Expected a nonempty regular file within the allowed size.');
    }
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function hashHandle(handle) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const expectedSize = (await handle.stat()).size;
  let position = 0;
  while (position < expectedSize) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize - position), position);
    if (!bytesRead) reject('SOURCE_CHANGED', 'File shrank while hashing.');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if ((await handle.stat()).size !== expectedSize) reject('SOURCE_CHANGED', 'File size changed while hashing.');
  return hash.digest('hex');
}

async function fileHash(path, maxBytes) {
  const handle = await openRegular(path, maxBytes);
  try { return await hashHandle(handle); } finally { await handle.close(); }
}

// A separate immutable file per policy+circuit survives changed parameters,
// revised descriptions and failed attempts. Callers cannot request a new seed.
async function samplingContext(folder,circuitSha256){
  const directory=join(folder,'.qcat-run-contexts');
  await mkdir(directory,{recursive:true,mode:0o700});
  if(await realpath(directory)!==directory||!(await lstat(directory)).isDirectory())reject('INVALID_CONTEXT','Sampling context directory must be a real local directory.');
  const path=join(directory,sha256(SAMPLING_POLICY)+'-'+circuitSha256+'.json');
  let created;
  try{
    created=await open(path,'wx',0o600);
    const record={schemaVersion:'qcat-local-sampling-context-v1',policy:SAMPLING_POLICY,circuitSha256,seed:randomBytes(32).toString('hex'),createdAt:new Date().toISOString()};
    await created.writeFile(JSON.stringify(record)+'\n');await created.sync();
  }catch(error){if(error.code!=='EEXIST')throw error;}
  finally{await created?.close();}
  const handle=await openRegular(path,4096);
  try{
    const bytes=await handle.readFile();let record;
    try{record=JSON.parse(utf8.decode(bytes));}catch{reject('INVALID_CONTEXT','Saved sampling context is unreadable; it will not be replaced.');}
    if(!record||Object.keys(record).sort().join(',')!=='circuitSha256,createdAt,policy,schemaVersion,seed'||record.schemaVersion!=='qcat-local-sampling-context-v1'||record.policy!==SAMPLING_POLICY||record.circuitSha256!==circuitSha256||!SHA256.test(record.seed??'')||typeof record.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(record.createdAt)||!Number.isFinite(Date.parse(record.createdAt)))reject('INVALID_CONTEXT','Saved sampling context does not match this circuit and policy; it will not be replaced.');
    return {path,sha256:sha256(bytes),seed:record.seed};
  }finally{await handle.close();}
}

async function snapshot(source, destination, executable = false, maxBytes) {
  const input = await openRegular(source, maxBytes);
  let output;
  try {
    const statBefore = await input.stat();
    if (executable && !(statBefore.mode & 0o111)) reject('INVALID_VERIFIER', 'Verifier is not executable.');
    const before = await hashHandle(input);
    output = await open(destination, 'wx', 0o600);
    const copyHash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < statBefore.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, statBefore.size - position), position);
      if (!bytesRead) reject('SOURCE_CHANGED', 'Source shrank while copying.');
      copyHash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        if (!result.bytesWritten) reject('COPY_FAILED', 'Snapshot write made no progress.');
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await output.sync();
    const copied = copyHash.digest('hex');
    const after = await hashHandle(input);
    const current = await lstat(source);
    if (before !== copied || before !== after || !current.isFile()
        || current.ino !== statBefore.ino || current.dev !== statBefore.dev) {
      reject('SOURCE_CHANGED', 'A source file changed during snapshot creation.');
    }
    await output.close(); output = undefined;
    await chmod(destination, executable ? 0o500 : 0o400);
    if (await fileHash(destination, maxBytes) !== before) reject('COPY_FAILED', 'Snapshot digest mismatch.');
    return before;
  } finally { await output?.close(); await input.close(); }
}

async function captureProcess(executable, cwd) {
  const startedAt = new Date().toISOString();
  const startedTick = process.hrtime.bigint();
  return await new Promise((resolveCapture) => {
    let outputLimit = false;
    let timedOut = false;
    let spawnError = null;
    let streamError = null;
    let size = 0;
    const stdout = [];
    const stderr = [];
    const child = spawn(executable, [], { cwd, shell: false, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: cwd } });
    const terminate = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, MAX_RUN_MS);
    timer.unref();
    const receive = (destination, chunk) => {
      const remaining = CAPTURE_BYTES - size;
      const kept = chunk.subarray(0, Math.max(0, remaining));
      if (kept.length) { destination.push(Buffer.from(kept)); size += kept.length; }
      if (chunk.length > remaining) { outputLimit = true; terminate(); }
    };
    child.stdout.on('data', (chunk) => receive(stdout, chunk));
    child.stderr.on('data', (chunk) => receive(stderr, chunk));
    child.stdout.on('error', (error) => { streamError = error; terminate(); });
    child.stderr.on('error', (error) => { streamError = error; terminate(); });
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveCapture({ startedAt, finishedAt: new Date().toISOString(),
        durationMs: Number((process.hrtime.bigint() - startedTick) / 1_000_000n),
        exitCode, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
        outputLimit, timedOut, spawnError, streamError });
    });
  });
}

function asError(error) {
  return error instanceof RunCaptureError ? error
    : new RunCaptureError('CAPTURE_FAILED', error?.message ?? String(error), { cause: error });
}

function decodeOutput(bytes) {
  try { return { text: utf8.decode(bytes), invalidUtf8: false }; }
  catch { return { text: bytes.toString('utf8'), invalidUtf8: true }; }
}

function boundedUtf8(text, limit) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= limit) return bytes;
  let end = Math.max(0, limit);
  while (end > 0) {
    try { utf8.decode(bytes.subarray(0, end)); return bytes.subarray(0, end); }
    catch { end -= 1; }
  }
  return Buffer.alloc(0);
}

function makeLog(execution, hashes, error) {
  const out = decodeOutput(execution?.stdout ?? Buffer.alloc(0));
  const err = decodeOutput(execution?.stderr ?? Buffer.alloc(0));
  const stdout = boundedUtf8(out.text, CAPTURE_BYTES);
  const stderr = boundedUtf8(err.text, CAPTURE_BYTES - stdout.length);
  const metadata = Buffer.from(JSON.stringify({
    format: 'qcat-run-log-v1', evidenceKind: 'author-provided', ...hashes,
    startedAt: execution?.startedAt ?? null, finishedAt: execution?.finishedAt ?? null,
    durationMs: execution?.durationMs ?? null, exitCode: execution?.exitCode ?? null,
    signal: execution?.signal ?? null, timeout: execution?.timedOut ?? false,
    outputLimit: execution?.outputLimit ?? false,
    invalidUtf8: out.invalidUtf8 || err.invalidUtf8,
    outputTruncated: (execution?.outputLimit ?? false)
      || stdout.length < Buffer.byteLength(out.text) || stderr.length < Buffer.byteLength(err.text),
    error: error ? { code: error.code, message: error.message.slice(0, 2048) } : null,
  }, null, 2), 'utf8');
  const log = Buffer.concat([
    Buffer.from(`QCAT-RUN-LOG-V1\nMETADATA ${metadata.length} UTF8-BYTES\n`), metadata,
    Buffer.from(`\nSTDOUT ${stdout.length} UTF8-BYTES\n`), stdout,
    Buffer.from(`\nSTDERR ${stderr.length} UTF8-BYTES\n`), stderr,
    Buffer.from('\nEND QCAT-RUN-LOG-V1\n'),
  ]);
  if (log.length > MAX_LOG_BYTES) reject('LOG_TOO_LARGE', 'Capture log exceeds its hard limit.');
  return log;
}

/**
 * Freeze the inputs and executable, run the evaluator without arguments, and
 * create run.log + run-report.json using exclusive output creation.
 * This is author-provided evidence, NOT a sandbox or server qualification.
 */
export async function collectRun(options) {
  const settings = validateOptions(options);
  const folder = await realpath(resolve(settings.folder));
  const verifierPath = resolve(settings.verifierPath);
  const reportPath = join(folder, 'run-report.json');
  const logPath = join(folder, 'run.log');
  let reportFile;
  let logFile;
  let runtime;
  let reportComplete = false;
  let execution;
  let parsed;
  let context;
  let failure;
  const hashes = { taskManifestSha256: settings.taskManifestSha256 };
  try {
    // Both names must be unused before any verifier process is launched.
    reportFile = await open(reportPath, 'wx', 0o600);
    logFile = await open(logPath, 'wx', 0o600);
    try {
      runtime = await realpath(await mkdtemp(join(tmpdir(), 'qcat-run-')));
      const circuit = join(folder, 'ops.bin');
      const parameters = join(folder, 'parameters.json');
      const frozenCircuit = join(runtime, 'ops.bin');
      const frozenParameters = join(runtime, 'parameters.json');
      const frozenVerifier = join(runtime, 'eval_circuit');
      hashes.circuitSha256 = await snapshot(circuit, frozenCircuit, false, MAX_CIRCUIT_BYTES);
      hashes.parametersSha256 = await snapshot(parameters, frozenParameters, false, MAX_METADATA_BYTES);
      hashes.verifierBuildSha256 = await snapshot(verifierPath, frozenVerifier, true);
      context=await samplingContext(folder,hashes.circuitSha256);
      hashes.samplingContextSha256=context.sha256;
      const seedFile=await open(join(runtime,'sampling-seed.bin'),'wx',0o400);
      try{await seedFile.writeFile(Buffer.from(context.seed,'hex'));await seedFile.sync();}finally{await seedFile.close();}
      const parameterFile = await openRegular(frozenParameters, MAX_METADATA_BYTES);
      try {
        const value = JSON.parse(utf8.decode(await parameterFile.readFile()));
        if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_PARAMETERS', 'parameters.json must be a JSON object.');
      } finally { await parameterFile.close(); }
      execution = await captureProcess(frozenVerifier, runtime);
      if (execution.outputLimit) reject('OUTPUT_LIMIT', 'Evaluator output exceeded the 8 MiB log budget.');
      if (execution.timedOut) reject('TIMEOUT', 'Evaluator exceeded the two-hour execution limit.');
      if (execution.spawnError) reject('SPAWN_FAILED', execution.spawnError.message);
      if (execution.streamError) reject('STREAM_FAILED', execution.streamError.message);
      if (execution.signal) reject('SIGNALLED', `Evaluator was terminated by ${execution.signal}.`);
      if (execution.exitCode !== 0) reject('NONZERO_EXIT', `Evaluator exited with status ${execution.exitCode}.`);
      if (execution.finishedAt <= execution.startedAt || execution.durationMs < 1) {
        reject('INVALID_RUN_TIME', 'Captured wall-clock interval and monotonic duration must both be positive.');
      }
      for (const [source, frozen, digest, maxBytes] of [
        [circuit, frozenCircuit, hashes.circuitSha256, MAX_CIRCUIT_BYTES],
        [parameters, frozenParameters, hashes.parametersSha256, MAX_METADATA_BYTES],
        [verifierPath, frozenVerifier, hashes.verifierBuildSha256, undefined],
      ]) {
        if (await fileHash(source, maxBytes) !== digest || await fileHash(frozen, maxBytes) !== digest) {
          reject('SOURCE_CHANGED', 'A circuit, parameter file, or verifier changed during the run.');
        }
      }
      if(await fileHash(context.path,4096)!==context.sha256||await fileHash(join(runtime,'sampling-seed.bin'),32)!==sha256(Buffer.from(context.seed,'hex')))reject('SOURCE_CHANGED','Sampling context changed during the run.');
      const out = decodeOutput(execution.stdout);
      const err = decodeOutput(execution.stderr);
      if (out.invalidUtf8 || err.invalidUtf8) reject('INVALID_UTF8', 'Evaluator streams must be valid UTF-8.');
      let nativeFile;
      try{nativeFile=await openRegular(join(runtime,'result.json'),MAX_RESULT_BYTES);const before=await hashHandle(nativeFile);parsed=parseEvaluatorResult(await nativeFile.readFile(),context.seed);if(await hashHandle(nativeFile)!==before||await fileHash(join(runtime,'result.json'),MAX_RESULT_BYTES)!==before)reject('SOURCE_CHANGED','Native result changed while it was read.');hashes.nativeResultSha256=before;}catch(error){if(error.code==='ENOENT')reject('MISSING_RESULT','The verifier did not produce result.json.');throw error;}finally{await nativeFile?.close();}
    } catch (error) { failure = asError(error); }

    // Even rejected execution or parsing keeps its separated, bounded log.
    const log = makeLog(execution, hashes, failure);
    await logFile.writeFile(log);
    await logFile.sync();
    await logFile.close(); logFile = undefined;
    if (failure) { failure.logPath = logPath; throw failure; }
    const logSha256 = sha256(log);
    if (await fileHash(logPath, MAX_LOG_BYTES) !== logSha256) reject('LOG_CHANGED', 'Capture log digest changed before report creation.');
    const report = {
      schemaVersion: 'qcat-run-report-v2', status: 'completed', taskVersion: TASK_VERSION,
      taskManifestSha256: settings.taskManifestSha256,
      circuitSha256: hashes.circuitSha256, parametersSha256: hashes.parametersSha256,
      verifier: { name: 'eval_circuit', version: settings.verifierVersion, buildSha256: hashes.verifierBuildSha256 },
      run: { startedAt: execution.startedAt, finishedAt: execution.finishedAt,
        durationMs: execution.durationMs, exitCode: 0 },
      sampling:{policy:SAMPLING_POLICY,...parsed.sampling},
      checks:{requestedInputs:RANDOM_INPUTS,executedInputs:parsed.coverage.executedInputs,executedBatches:parsed.coverage.executedBatches,...parsed.errors},
      failureDetails:parsed.failureDetails,
      resources:Object.fromEntries(['qubits','totalExecutedToffoli','roundedMeanExecutedToffoli','tGates','score'].map(key=>[key,parsed.resources[key]])),logSha256,
    };
    reportSchema.parse(report);
    await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await reportFile.sync();
    await reportFile.close(); reportFile = undefined;
    reportComplete = true;
    return report;
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new RunCaptureError('OUTPUT_EXISTS', 'run.log and run-report.json must both be absent. Archive previous outputs before retrying; preserve .qcat-run-contexts so the same circuit keeps its sampling context.', { cause: error });
    }
    throw error;
  } finally {
    await logFile?.close();
    if (reportFile) {
      await reportFile.close();
      if (!reportComplete) await rm(reportPath, { force: true });
    }
    if (runtime) await rm(runtime, { recursive: true, force: true });
  }
}
