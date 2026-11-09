"""Gaia DR3 밝은 별 1,000만 개(cosmoscout/gaia-stars) → '보이는 구역만' 받는 쿼드트리 타일
좌표: 태양 중심 황도 직교좌표(광년). 쿼드트리는 황도면(x,y) 기준, 각 칸에는 그 칸에서 아직 안 넣은
가장 밝은 별 K개만 → 멀리서는 밝은 별, 확대하면 더 어두운 별이 채워짐.
파일: Uint32 N | Uint16 lx[N] | Uint16 ly[N] | Int16 z[N](asinh 압축) | Uint8 G×10[N] | Int8 (BP-RP)×50[N]"""
import sys, os, json, numpy as np, pandas as pd
SRC, OUT = sys.argv[1], sys.argv[2]
R, K, MAXL = 65536.0, 6000, 12
ZK = 3300.0  # z 압축: round(asinh(z/10)*ZK)
df = pd.read_csv(SRC, sep='|', usecols=['hipparcos_id', 'ra', 'dec', 'parallax', 'phot_g_mean_mag', 'bp_rp'],
                 dtype={'hipparcos_id': np.int64, 'ra': np.float64, 'dec': np.float64, 'parallax': np.float64, 'phot_g_mean_mag': np.float32, 'bp_rp': np.float32})
n0 = len(df)
df = df[(df.hipparcos_id < 0) & (df.parallax > 0.05)]  # 히파르코스 별은 기본 목록에 이미 있음
ly = 3261.56 / df.parallax.values
ra, dec = np.radians(df.ra.values), np.radians(df.dec.values)
eps = np.radians(23.4392911)
sb = np.sin(dec) * np.cos(eps) - np.cos(dec) * np.sin(eps) * np.sin(ra)
b = np.arcsin(sb)
lam = np.arctan2(np.sin(ra) * np.cos(eps) + np.tan(dec) * np.sin(eps), np.cos(ra))
x = ly * np.cos(b) * np.cos(lam); y = ly * np.cos(b) * np.sin(lam); z = ly * np.sin(b)
keep = (np.abs(x) < R) & (np.abs(y) < R)
x, y, z = x[keep], y[keep], z[keep]
g = df.phot_g_mean_mag.values[keep]; c = np.nan_to_num(df.bp_rp.values[keep], nan=0.8)
order = np.argsort(g, kind='stable'); x, y, z, g, c = x[order], y[order], z[order], g[order], c[order]
N = len(x); print('input', n0, 'kept', N)
level = np.full(N, -1, np.int8)
for L in range(MAXL + 1):
    rest = np.nonzero(level < 0)[0]
    if not len(rest): break
    n = 1 << L; cs = 2 * R / n
    ix = np.clip(((x[rest] + R) // cs).astype(np.int64), 0, n - 1); iy = np.clip(((y[rest] + R) // cs).astype(np.int64), 0, n - 1)
    cell = ix * n + iy
    srt = np.argsort(cell, kind='stable')  # 칸 안에서는 밝은 순 유지
    cs_sorted = cell[srt]
    starts = np.r_[0, np.nonzero(np.diff(cs_sorted))[0] + 1]
    rank = np.arange(len(srt)) - np.repeat(starts, np.diff(np.r_[starts, len(srt)]))
    take = srt[rank < K] if L < MAXL else srt
    level[rest[take]] = L
    print('L', L, 'assigned', len(take))
nodes = {}
os.makedirs(OUT, exist_ok=True)
for L in range(MAXL + 1):
    idx = np.nonzero(level == L)[0]
    if not len(idx): continue
    n = 1 << L; cs = 2 * R / n
    ix = np.clip(((x[idx] + R) // cs).astype(np.int64), 0, n - 1); iy = np.clip(((y[idx] + R) // cs).astype(np.int64), 0, n - 1)
    cell = ix * n + iy
    srt = np.argsort(cell, kind='stable'); idx, cell, ix, iy = idx[srt], cell[srt], ix[srt], iy[srt]
    bounds = np.r_[0, np.nonzero(np.diff(cell))[0] + 1, len(cell)]
    os.makedirs(f'{OUT}/{L}', exist_ok=True)
    for a, bnd in zip(bounds[:-1], bounds[1:]):
        ii = idx[a:bnd]; cx, cy = int(ix[a]), int(iy[a])
        x0, y0 = -R + cx * cs, -R + cy * cs
        lx = np.clip(np.round((x[ii] - x0) / cs * 65535), 0, 65535).astype('<u2')
        lyy = np.clip(np.round((y[ii] - y0) / cs * 65535), 0, 65535).astype('<u2')
        zz = np.clip(np.round(np.arcsinh(z[ii] / 10) * ZK), -32767, 32767).astype('<i2')
        mg = np.clip(np.round(g[ii] * 10), 0, 255).astype('u1'); cc = np.clip(np.round(c[ii] * 50), -127, 127).astype('i1')
        with open(f'{OUT}/{L}/{cx}-{cy}.bin', 'wb') as f:
            f.write(np.array([len(ii)], '<u4').tobytes()); f.write(lx.tobytes()); f.write(lyy.tobytes()); f.write(zz.tobytes()); f.write(mg.tobytes()); f.write(cc.tobytes())
        nodes[f'{L}/{cx}-{cy}'] = int(len(ii))
json.dump({'R': R, 'K': K, 'maxL': MAXL, 'zk': ZK, 'total': int(N), 'src': 'Gaia DR3 (ESA/Gaia/DPAC) · 밝은 별 1,000만 개 목록: cosmoscout/gaia-stars', 'nodes': nodes},
          open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('nodes', len(nodes), 'total', N)
