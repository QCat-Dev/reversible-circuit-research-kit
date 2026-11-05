#!/usr/bin/env python3
"""Independent stdlib-only reference vectors. No circuit is loaded or executed.
Fixed software seed 00..1f; four inputs, never a platform qualification report.
"""
import hashlib, json, pathlib
P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f
N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141
G = (0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798,
     0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8)
SEED = bytes(range(32))
def add(a,b):
    if a is None: return b
    if b is None: return a
    x,y=a; u,v=b
    if x==u:
        if (y+v)%P==0: return None
        slope=(3*x*x*pow(2*y,-1,P))%P
    else: slope=((v-y)*pow((u-x)%P,-1,P))%P
    z=(slope*slope-x-u)%P
    return z,(slope*(x-z)-y)%P
def mul(k):
    value=None; base=G
    while k:
        if k&1: value=add(value,base)
        base=add(base,base); k>>=1
    return value
assert mul(2)[0] == 0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5
raw=hashlib.shake_256(b'qcat-ecc-random-10048-v1/inputs'+SEED).digest(4096)
position=0
def scalar():
    global position
    while True:
        assert position+32<=len(raw)
        k=int.from_bytes(raw[position:position+32],'little');position+=32
        if 1<=k<N: return k
cases=[]; digest=hashlib.sha3_256()
while len(cases)<4:
    a=mul(scalar()); b=mul(scalar())
    if a is None or b is None or a[0]==b[0]: continue
    expected=add(a,b)
    for v in [*a,*b]: digest.update(v.to_bytes(32,'little'))
    cases.append({'target':[f'{v:064x}' for v in a], 'offset':[f'{v:064x}' for v in b], 'expected':[f'{v:064x}' for v in expected]})
result={'purpose':'software-only reference vectors; no circuit execution', 'seed':SEED.hex(),
        'inputStreamFirst64':raw[:64].hex(),
        'measurementStreamFirst64':hashlib.shake_256(b'qcat-ecc-random-10048-v1/measurement'+SEED).digest(64).hex(),
        'count':len(cases),'inputDigest':digest.hexdigest(),'inputs':cases}
path=pathlib.Path(__file__).with_name('sampling-vectors.json')
text=json.dumps(result,indent=2)+'\n'
if path.exists():
    assert path.read_text()==text, 'committed vectors differ from independent re-derivation'
else: path.write_text(text)
print(json.dumps({k:result[k] for k in ['seed','count','inputDigest','inputStreamFirst64','measurementStreamFirst64']}))
