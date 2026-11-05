// Editable research lane. The builder supplies 56-byte QECCOPSZ operation records.
// Consume the entire async input and emit a valid async stream of 56-byte records.
// Start with this narrow, semantics-preserving cancellation. Record each changed
// hypothesis in experiments/ before running the independent precheck.
const INVOLUTIONS=new Set([6,7,8,9,10,13,14]); // X, Z, CX, CZ, SWAP, CCX, CCZ.

function shouldCancelPair(left,right){
  const kind=left.readUInt32LE(0);
  return INVOLUTIONS.has(kind)&&left.equals(right);
}

export async function* transform(records){
  let pending=null;
  for await(const record of records){
    if(pending===null){pending=record;continue;}
    if(shouldCancelPair(pending,record)){pending=null;continue;}
    yield pending;pending=record;
  }
  if(pending!==null)yield pending;
}
