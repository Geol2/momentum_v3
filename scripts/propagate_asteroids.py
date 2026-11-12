# 행성 섭동(JPL 근사 궤도요소 8행성)을 넣은 태양 중심 N체 적분 — 도약 개구리법, 근일점이 가까운 천체는 짧은 간격
import numpy as np, math
K2 = 0.01720209895**2
DEG = math.pi/180
# JPL 근사 행성 궤도요소 (1800–2050)
EL = {
 'Me': ([0.38709927,0.20563593,7.00497902,252.2503235,77.45779628,48.33076593],[0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081], 1.660114e-7),
 'Ve': ([0.72333566,0.00677672,3.39467605,181.9790995,131.60246718,76.67984255],[0.0000039,-0.00004107,-0.0007889,58517.81538729,0.00268329,-0.27769418], 2.447838e-6),
 'Ea': ([1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0],[0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0], 3.040432e-6),
 'Ma': ([1.52371034,0.0933941,1.84969142,-4.55343205,-23.94362959,49.55953891],[0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343], 3.227156e-7),
 'Ju': ([5.202887,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909],[-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106], 9.547919e-4),
 'Sa': ([9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448],[-0.0012506,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794], 2.858860e-4),
 'Ur': ([19.18916464,0.04725744,0.77263783,313.23810451,170.9542763,74.01692503],[-0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589], 4.366244e-5),
 'Ne': ([30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],[0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664], 5.151389e-5),
}
def kepE(M, e):
    E = M + e*np.sin(M)
    for _ in range(12): E = E - (E - e*np.sin(E) - M)/(1 - e*np.cos(E))
    return E
def rot(xp, yp, w, O, I):
    cw,sw,cO,sO,cI,sI = np.cos(w),np.sin(w),np.cos(O),np.sin(O),np.cos(I),np.sin(I)
    return np.stack([(cw*cO-sw*sO*cI)*xp+(-sw*cO-cw*sO*cI)*yp,(cw*sO+sw*cO*cI)*xp+(-sw*sO+cw*cO*cI)*yp,sw*sI*xp+cw*sI*yp],-1)
def planets(jd):
    T = (jd-2451545.0)/36525
    out=[]
    for k,(e0,r,m) in EL.items():
        a,e,I,L,wb,O = [e0[i]+r[i]*T for i in range(6)]
        w=(wb-O)*DEG; M=(((L-wb)%360+540)%360-180)*DEG; E=kepE(M,e)
        p=rot(a*(math.cos(E)-e), a*math.sqrt(1-e*e)*math.sin(E), w, O*DEG, I*DEG)
        out.append((p, m*K2))
    return out
def el2rv(a,e,i,om,w,M):
    E=kepE(M,e); n=np.sqrt(K2/a**3)
    xp=a*(np.cos(E)-e); yp=a*np.sqrt(1-e*e)*np.sin(E)
    Ed=n/(1-e*np.cos(E)); vxp=-a*np.sin(E)*Ed; vyp=a*np.sqrt(1-e*e)*np.cos(E)*Ed
    return rot(xp,yp,w,om,i), rot(vxp,vyp,w,om,i)
def rv2el(r,v):
    rn=np.linalg.norm(r,axis=-1); v2=(v*v).sum(-1)
    h=np.cross(r,v); hn=np.linalg.norm(h,axis=-1)
    i=np.arccos(np.clip(h[:,2]/hn,-1,1))
    nvec=np.stack([-h[:,1],h[:,0],np.zeros_like(rn)],-1); nn=np.linalg.norm(nvec,axis=-1)+1e-300
    ev=(np.cross(v,h))/K2 - r/rn[:,None]; e=np.linalg.norm(ev,axis=-1)
    a=1/(2/rn - v2/K2)
    om=np.arctan2(nvec[:,1],nvec[:,0])%(2*np.pi)
    w=np.arctan2((np.cross(nvec,ev)*h).sum(-1)/hn, (nvec*ev).sum(-1))%(2*np.pi)
    nu=np.arctan2((np.cross(ev,r)*h).sum(-1)/hn, (ev*r).sum(-1))
    E=2*np.arctan2(np.sqrt(np.clip(1-e,0,None))*np.sin(nu/2), np.sqrt(1+e)*np.cos(nu/2))
    M=(E-e*np.sin(E))%(2*np.pi)
    return a,e,i,om,w,M
def acc(r, pl):
    rn=np.linalg.norm(r,axis=-1)
    a=-K2*r/rn[:,None]**3
    for p,gm in pl:
        d=p[None,:]-r; dn=np.linalg.norm(d,axis=-1)
        a+=gm*(d/dn[:,None]**3 - p/np.linalg.norm(p)**3)
    return a
def propagate(r,v,jd0,jd1,dt=1.0):
    n=int(math.ceil(abs(jd1-jd0)/dt)); h=(jd1-jd0)/n; t=jd0
    a=acc(r,planets(t))
    for k in range(n):
        v=v+0.5*h*a; r=r+h*v; t=jd0+(k+1)*h
        a=acc(r,planets(t)); v=v+0.5*h*a
    return r,v
# ── 소행성 15만 개를 N체 적분으로 새 기준일까지 옮기기 ──
# 사용: python3 scripts/propagate_asteroids.py 원본.bin 결과.bin [목표 JD]
import sys
import numpy as np, struct, sys, time

src=sys.argv[1] if len(sys.argv)>1 else 'src/game/universe/small-bodies.bin'
b=open(src,'rb').read()
N=struct.unpack_from('<I',b,0)[0]; ep=struct.unpack_from('<d',b,4)[0]; o=12
def take(dt,sz):
    global o; a=np.frombuffer(b,dt,N,o).astype(np.float64); o+=N*sz; return a
a=take('<f4',4); e=take('<f4',4); iU=take('<u2',2); omU=take('<u2',2); wU=take('<u2',2); mU=take('<u2',2)
H=np.frombuffer(b,np.uint8,N,o).copy(); o+=N
rest=b[o:]
print('N',N,'epoch',ep,'rest bytes',len(rest))
i=iU/65535*np.pi; om=omU/65535*2*np.pi; w=wU/65535*2*np.pi; M=mU/65535*2*np.pi
jdT=float(sys.argv[3]) if len(sys.argv)>3 else 2461356.5
q=a*(1-e)
out=[np.zeros(N) for _ in range(6)]
groups=[(q<0.3,0.05),((q>=0.3)&(q<0.7),0.2),((q>=0.7)&(q<1.2),0.5),(q>=1.2,1.0)]
t0=time.time()
for m,dt in groups:
    idx=np.where(m)[0]
    if not len(idx): continue
    r,v=el2rv(a[idx],e[idx],i[idx],om[idx],w[idx],M[idx])
    r,v=propagate(r,v,ep,jdT,dt)
    el=rv2el(r,v)
    for k in range(6): out[k][idx]=el[k]
    print('group',dt,len(idx),f'{time.time()-t0:.0f}s',flush=True)
A,E,I,OM,W,MM=out
bad=~np.isfinite(A)|(A<=0)|(E>=1)
print('unbound/bad',bad.sum())
# 실패한 것은 2체로 유지
n=np.sqrt(K2/a**3)
A[bad]=a[bad]; E[bad]=e[bad]; I[bad]=i[bad]; OM[bad]=om[bad]; W[bad]=w[bad]; MM[bad]=(M[bad]+n[bad]*(jdT-ep))%(2*np.pi)
print('Δa median',np.median(np.abs(A-a)),'max',np.abs(A-a).max())
q16=lambda x,span: np.round(np.clip(x/span,0,1)*65535).astype('<u2')
with open((sys.argv[2] if len(sys.argv)>2 else 'small-bodies.new.bin'),'wb') as f:
    f.write(struct.pack('<Id',N,jdT)); f.write(b'\0'*0 if False else b'')
    hdr_pad=12-12
    f.write(A.astype('<f4').tobytes()); f.write(E.astype('<f4').tobytes())
    f.write(q16(I,np.pi).tobytes()); f.write(q16(OM%(2*np.pi),2*np.pi).tobytes()); f.write(q16(W%(2*np.pi),2*np.pi).tobytes()); f.write(q16(MM%(2*np.pi),2*np.pi).tobytes())
    f.write(H.tobytes()); f.write(rest)
print('done',time.time()-t0)
