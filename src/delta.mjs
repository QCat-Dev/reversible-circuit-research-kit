import {createHash} from 'node:crypto';
import {createZstdCompress,createZstdDecompress} from 'node:zlib';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const ORIGIN=Symbol.for('qcat.original-record-index');
export const MAX_DELTA_BYTES=16*1024*1024;
const MAGIC=Buffer.from('QCATDLT1');
const HEADER_BYTES=88, RECORD_BYTES=56, MAX_OPS=40_000_000, MAX_CIRCUIT_BYTES=128*1024*1024;
const CHUNK_BYTES=RECORD_BYTES*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export class DeltaRecorder{
  constructor(){this.commands=[];this.bytes=HEADER_BYTES;this.unavailable=false;this.lastCopyEnd=0;}
  observe(record){
    if(this.unavailable)return;
    const origin=record[ORIGIN],last=this.commands.at(-1);
    if(Number.isInteger(origin)&&origin>=this.lastCopyEnd&&origin<MAX_OPS){
      if(last?.kind==='copy'&&last.start+last.count===origin)last.count++;
      else{this.commands.push({kind:'copy',start:origin,count:1});this.bytes+=9;}
      this.lastCopyEnd=origin+1;
    }else{
      if(last?.kind==='literal'){last.records.push(Buffer.from(record));last.count++;this.bytes+=RECORD_BYTES;}
      else{this.commands.push({kind:'literal',records:[Buffer.from(record)],count:1});this.bytes+=5+RECORD_BYTES;}
    }
    if(this.bytes>MAX_DELTA_BYTES||this.commands.length>1_000_000){this.unavailable=true;this.commands=[];}
  }
  finish({parentSha256,circuitSha256,parentOperations,outputOperations,circuitBytes}){
    if(this.unavailable||!hex(parentSha256)||!hex(circuitSha256)||!Number.isInteger(parentOperations)||parentOperations<1||parentOperations>MAX_OPS||!Number.isInteger(outputOperations)||outputOperations<1||outputOperations>MAX_OPS||!Number.isInteger(circuitBytes)||circuitBytes<17||circuitBytes>MAX_CIRCUIT_BYTES)return null;
    const bytes=Buffer.allocUnsafe(this.bytes);MAGIC.copy(bytes,0);Buffer.from(parentSha256,'hex').copy(bytes,8);Buffer.from(circuitSha256,'hex').copy(bytes,40);
    bytes.writeUInt32LE(outputOperations,72);bytes.writeUInt32LE(circuitBytes,76);bytes.writeUInt32LE(parentOperations,80);bytes.writeUInt32LE(this.commands.length,84);
    let offset=HEADER_BYTES;
    for(const command of this.commands){
      if(command.kind==='copy'){bytes[offset++]=0;bytes.writeUInt32LE(command.start,offset);offset+=4;bytes.writeUInt32LE(command.count,offset);offset+=4;}
      else{bytes[offset++]=1;bytes.writeUInt32LE(command.count,offset);offset+=4;for(const record of command.records){record.copy(bytes,offset);offset+=RECORD_BYTES;}}
    }
    if(offset!==bytes.length)throw new Error('Internal delta length mismatch.');
    return bytes;
  }
}
export function parseDelta(input){
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  if(bytes.length<HEADER_BYTES||bytes.length>MAX_DELTA_BYTES||!bytes.subarray(0,8).equals(MAGIC))throw new Error('Invalid or oversized QCATDLT1 file.');
  const parentSha256=bytes.subarray(8,40).toString('hex'),circuitSha256=bytes.subarray(40,72).toString('hex');
  const outputOperations=bytes.readUInt32LE(72),circuitBytes=bytes.readUInt32LE(76),parentOperations=bytes.readUInt32LE(80),commandCount=bytes.readUInt32LE(84);
  if(!outputOperations||outputOperations>MAX_OPS||!parentOperations||parentOperations>MAX_OPS||circuitBytes<17||circuitBytes>MAX_CIRCUIT_BYTES||!commandCount||commandCount>1_000_000)throw new Error('Delta header is outside the circuit limits.');
  let offset=HEADER_BYTES,lastCopyEnd=0,outputCount=0;const commands=[];
  for(let i=0;i<commandCount;i++){
    if(offset>=bytes.length)throw new Error('Truncated delta command.');
    const tag=bytes[offset++];
    if(tag===0){
      if(offset+8>bytes.length)throw new Error('Truncated delta copy.');
      const start=bytes.readUInt32LE(offset),count=bytes.readUInt32LE(offset+4);offset+=8;
      if(!count||start<lastCopyEnd||start+count>parentOperations)throw new Error('Delta copies must be ordered nonoverlapping parent ranges.');
      lastCopyEnd=start+count;outputCount+=count;commands.push({kind:'copy',start,count});
    }else if(tag===1){
      if(offset+4>bytes.length)throw new Error('Truncated delta literal.');
      const count=bytes.readUInt32LE(offset);offset+=4;
      if(!count||count>MAX_OPS||count>(bytes.length-offset)/RECORD_BYTES)throw new Error('Invalid delta literal length.');
      const records=bytes.subarray(offset,offset+count*RECORD_BYTES);offset+=count*RECORD_BYTES;
      for(let j=0;j<records.length;j+=RECORD_BYTES)if(records.readUInt32LE(j)>17)throw new Error('Delta contains an unknown operation kind.');
      outputCount+=count;commands.push({kind:'literal',records,count});
    }else throw new Error('Unknown delta command.');
    if(outputCount>outputOperations)throw new Error('Delta output exceeds its declared operation count.');
  }
  if(offset!==bytes.length||outputCount!==outputOperations)throw new Error('Delta length or operation count mismatch.');
  return {parentSha256,circuitSha256,parentOperations,outputOperations,circuitBytes,commands};
}
export function inspectDelta(bytes){const {parentSha256,circuitSha256,parentOperations,outputOperations,circuitBytes,commands}=parseDelta(bytes);return {schemaVersion:'qcat-delta-v1',parentSha256,circuitSha256,parentOperations,outputOperations,circuitBytes,commands:commands.length};}
export async function* fixedChunks(parts){
  let buffer=Buffer.allocUnsafe(CHUNK_BYTES),used=0;
  for await(const part of parts){
    const source=Buffer.isBuffer(part)?part:Buffer.from(part);
    if(source.length%RECORD_BYTES)throw new Error('Circuit record chunk is not aligned.');
    let at=0;
    while(at<source.length){const n=Math.min(CHUNK_BYTES-used,source.length-at);source.copy(buffer,used,at,at+n);used+=n;at+=n;
      if(used===CHUNK_BYTES){yield buffer;buffer=Buffer.allocUnsafe(CHUNK_BYTES);used=0;}
    }
  }
  if(used)yield Buffer.from(buffer.subarray(0,used));
}
export async function reconstructDelta(parentInput,deltaInput,{signal}={}){
  const parent=Buffer.isBuffer(parentInput)?parentInput:Buffer.from(parentInput),delta=parseDelta(deltaInput);
  if(sha(parent)!==delta.parentSha256||parent.length<20||parent.subarray(0,8).toString()!=='QECCOPSZ'||parent.readBigUInt64LE(8)!==BigInt(delta.parentOperations))throw new Error('Delta parent circuit fingerprint or operation count mismatch.');
  async function* alignedBlocks(){
    let carry=Buffer.alloc(0),count=0;
    for await(const chunk of Readable.from([parent.subarray(16)]).pipe(createZstdDecompress())){
      if(signal?.aborted)throw new Error('Delta reconstruction interrupted.');
      const bytes=carry.length?Buffer.concat([carry,chunk]):chunk,usable=bytes.length-bytes.length%RECORD_BYTES;
      if(usable){count+=usable/RECORD_BYTES;if(count>delta.parentOperations)throw new Error('Parent decoded more operations than declared.');yield bytes.subarray(0,usable);}
      carry=Buffer.from(bytes.subarray(usable));
    }
    if(carry.length||count!==delta.parentOperations)throw new Error('Parent decoded operation count mismatch.');
  }
  async function* emitted(){
    const iterator=alignedBlocks()[Symbol.asyncIterator]();let block=Buffer.alloc(0),offset=0,sourceIndex=0;
    async function ensure(){if(offset<block.length)return;const next=await iterator.next();if(next.done)throw new Error('Delta copy exceeds parent stream.');block=next.value;offset=0;}
    try{
      for(const command of delta.commands){
        if(signal?.aborted)throw new Error('Delta reconstruction interrupted.');
        if(command.kind==='literal'){yield command.records;continue;}
        while(sourceIndex<command.start){await ensure();const skip=Math.min(command.start-sourceIndex,(block.length-offset)/RECORD_BYTES);offset+=skip*RECORD_BYTES;sourceIndex+=skip;}
        let remaining=command.count;
        while(remaining){await ensure();const n=Math.min(remaining,(block.length-offset)/RECORD_BYTES);yield block.subarray(offset,offset+n*RECORD_BYTES);offset+=n*RECORD_BYTES;sourceIndex+=n;remaining-=n;}
      }
    }finally{await iterator.return?.();}
  }
  const pieces=[];let length=16;
  await pipeline(Readable.from(fixedChunks(emitted())),createZstdCompress({level:3}),new Writable({write(chunk,_encoding,done){length+=chunk.length;if(length>MAX_CIRCUIT_BYTES){done(new Error('Reconstructed circuit exceeds 128 MiB.'));return;}pieces.push(Buffer.from(chunk));done();}}));
  const header=Buffer.alloc(16);header.write('QECCOPSZ',0,'ascii');header.writeBigUInt64LE(BigInt(delta.outputOperations),8);
  const circuit=Buffer.concat([header,...pieces],length);
  if(length!==delta.circuitBytes||sha(circuit)!==delta.circuitSha256)throw new Error('Delta reconstruction did not match the declared compiled circuit.');
  return circuit;
}
