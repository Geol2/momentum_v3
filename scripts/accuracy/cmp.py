import json, numpy as np, os, skyfield_data
from skyfield.api import load, Loader
from skyfield.framelib import ecliptic_J2000_frame, itrs
ts = load.timescale(builtin=True)
eph = load(os.path.join(os.path.dirname(skyfield_data.__file__),'data','de421.bsp'))
NAMES={'수성':'mercury','금성':'venus','지구':'earth','화성':'mars','목성':'jupiter barycenter','토성':'saturn barycenter','천왕성':'uranus barycenter','해왕성':'neptune barycenter'}
js=json.load(open('js.json'))
sun=eph['sun']; earth=eph['earth']; moon=eph['moon']
ang=lambda a,b: np.degrees(np.arccos(np.clip(np.dot(a,b)/np.linalg.norm(a)/np.linalg.norm(b),-1,1)))
res={k:[] for k in NAMES}; res['해(방향)']=[]; res['달(방향)']=[]; dist=[]
for row in js:
    t=ts.from_datetime(__import__('datetime').datetime.fromisoformat(row['t'].replace('Z','+00:00')))
    E_js=np.array(row['pl']['지구'])
    for k,n in NAMES.items():
        # 지구에서 본 방향(행성) — 지구는 태양 중심 위치 자체 비교
        tru=(eph[n] if n!='earth' else eph['earth']).at(t).frame_xyz(ecliptic_J2000_frame).au - sun.at(t).frame_xyz(ecliptic_J2000_frame).au
        if k=='지구': res[k].append(ang(np.array(row['pl'][k]), tru)); continue
        Et=earth.at(t).frame_xyz(ecliptic_J2000_frame).au - sun.at(t).frame_xyz(ecliptic_J2000_frame).au
        res[k].append(ang(np.array(row['pl'][k])-E_js, tru-Et))
    # 해·달: 지구 고정(ECEF) 벡터로 비교
    s_true=(sun-earth).at(t).frame_xyz(itrs).km
    m_true=(moon-earth).at(t).frame_xyz(itrs).km
    res['해(방향)'].append(ang(np.array(row['sun']), s_true))
    res['달(방향)'].append(ang(np.array(row['moon']), m_true))
    dist.append(abs(row['moonKm']-np.linalg.norm(m_true)))
print('| 천체 | 평균 오차 | 최대 오차 |')
for k,v in res.items(): print(f'| {k} | {np.mean(v):.3f}° | {np.max(v):.3f}° |')
print(f'| 달 거리 | {np.mean(dist):.0f} km | {np.max(dist):.0f} km |')
