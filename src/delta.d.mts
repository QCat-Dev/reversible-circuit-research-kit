export const ORIGIN: unique symbol;
export const MAX_DELTA_BYTES: number;
export class DeltaRecorder { observe(record:Buffer):void; finish(options:{parentSha256:string;circuitSha256:string;parentOperations:number;outputOperations:number;circuitBytes:number}):Buffer|null; }
export function parseDelta(bytes:Uint8Array):{parentSha256:string;circuitSha256:string;parentOperations:number;outputOperations:number;circuitBytes:number;commands:Array<any>};
export function inspectDelta(bytes:Uint8Array):{schemaVersion:string;parentSha256:string;circuitSha256:string;parentOperations:number;outputOperations:number;circuitBytes:number;commands:number};
export function fixedChunks(parts:AsyncIterable<Uint8Array>|Iterable<Uint8Array>):AsyncGenerator<Buffer>;
export function reconstructDelta(parent:Uint8Array,delta:Uint8Array,options?:{signal?:AbortSignal}):Promise<Buffer>;
