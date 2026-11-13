// 가까이 보기: (1) 외계 행성계 3D — 별 표면·행성 생김새(관측값 기반 상상도)·궤도·생명 가능 지대
//               (2) 인공위성·우주정거장·로켓 잔해·파편의 생김새(종류별 대표 모형)
import * as THREE from 'three';
import { exoStates } from './exoplanets.js';

const CSS = `
.cu-root{position:absolute;inset:0;z-index:30;background:#000;touch-action:none;overflow:hidden}
.cu-root.sat{background:radial-gradient(ellipse 120% 60% at 50% 135%,#4f9be0 0,#1d5aa0 30%,#0a2149 44%,#03060f 58%,#000 100%)}
.cu-root canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
.cu-info{position:absolute;top:10px;left:10px;right:58px;max-width:400px;padding:7px 10px;z-index:2;pointer-events:none}
.cu-info h3{margin:0;color:var(--g);font-size:12px;letter-spacing:.05em;text-shadow:var(--glow)}
.cu-info .sub{color:var(--gd);font-size:10.5px;margin-top:2px}
.cu-info ul{margin:5px 0 0;padding-left:15px;color:var(--gd);font-size:10.5px;line-height:1.45}
.cu-bar{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 10px calc(10px + env(safe-area-inset-bottom));z-index:2;
  background:linear-gradient(transparent,rgba(1,6,4,.92) 40%)}
.cu-bar button,.cu-close{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:10.5px;cursor:pointer;
  text-shadow:var(--glow);padding:7px 10px;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.cu-bar button.on{background:rgba(61,255,143,.28);color:#eafff2}
.cu-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0;z-index:3}
.cu-note{flex-basis:100%;text-align:center;font-size:10px;color:var(--gd);text-shadow:0 0 4px #000;pointer-events:none;margin-bottom:2px}
.cu-labs{position:absolute;inset:0;pointer-events:none;z-index:1}
.cu-lab{position:absolute;left:0;top:0;font-size:10.5px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #000,0 0 6px #000;transition:opacity .2s}
`;

// ── 공용: 화면 틀 + 궤도 카메라 ──
export function makeShell(host, cls, onClose) {
  if (!document.getElementById('cu-style')) { const st = document.createElement('style'); st.id = 'cu-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div');
  root.className = 'cu-root ' + cls;
  root.innerHTML = `<div class="cu-labs"></div><div class="cu-info mu-frame"><h3></h3><div class="sub"></div><ul></ul></div><button class="cu-close" aria-label="닫기">✕</button><div class="cu-bar"><div class="cu-note"></div></div>`;
  host.appendChild(root);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: cls === 'sat', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e5);
  const cv = renderer.domElement;
  const st = { yaw: 0.6, pitch: 0.35, dist: 50, minD: 0.5, maxD: 2000, target: new THREE.Vector3(), goalT: null, goalD: null, lastAct: 0, tap: null };
  const ptr = new Map(); let pinch = 0, moved = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; st.lastAct = performance.now(); });
  cv.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    const p = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); st.lastAct = performance.now();
    if (ptr.size === 1) { const dx = e.clientX - p[0], dy = e.clientY - p[1]; moved += Math.abs(dx) + Math.abs(dy); st.yaw -= dx * 0.006; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + dy * 0.006)); }
    else { moved = 99; const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) { st.dist = Math.max(st.minD, Math.min(st.maxD, st.dist * (pinch / d))); st.goalD = null; } pinch = d; }
  });
  const up = (e) => {
    if (ptr.has(e.pointerId) && ptr.size === 1 && moved < 8) { const r = cv.getBoundingClientRect(); st.tap = [e.clientX - r.left, e.clientY - r.top]; }
    ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.lastAct = performance.now(); st.goalD = null; st.dist = Math.max(st.minD, Math.min(st.maxD, st.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  let W = 1, H = 1;
  const resize = () => { W = root.clientWidth || 1; H = root.clientHeight || 1; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  const labs = root.querySelector('.cu-labs');
  const labels = [];
  const addLabel = (obj, text, color, off = 1) => { const el = document.createElement('div'); el.className = 'cu-lab'; el.textContent = text; el.style.color = color; labs.appendChild(el); const L = { obj, el, off }; labels.push(L); return L; };
  const v = new THREE.Vector3();
  const project = (p) => { v.copy(p).project(camera); if (v.z > 1) return null; return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
  function updateCamera(dt) {
    if (st.goalT) { st.target.lerp(st.goalT(), Math.min(1, dt * 3)); }
    if (st.goalD) { st.dist = Math.exp(Math.log(st.dist) + (Math.log(st.goalD) - Math.log(st.dist)) * Math.min(1, dt * 2.5)); if (Math.abs(Math.log(st.dist / st.goalD)) < 0.01) st.goalD = null; }
    const c = new THREE.Vector3(Math.cos(st.pitch) * Math.sin(st.yaw), Math.sin(st.pitch), Math.cos(st.pitch) * Math.cos(st.yaw)).multiplyScalar(st.dist);
    camera.position.copy(st.target).add(c); camera.near = st.dist * 0.002; camera.far = st.dist * 400 + 100; camera.updateProjectionMatrix(); camera.lookAt(st.target);
    const boxes = [];
    for (const L of labels) {
      const wp = L.obj.getWorldPosition ? L.obj.getWorldPosition(new THREE.Vector3()) : L.obj;
      const s = L.hidden ? null : project(wp);
      let ok = false;
      if (s) {
        const rpx = L.rad ? (L.rad / camera.position.distanceTo(wp)) * (H / 2) / Math.tan((camera.fov * Math.PI) / 360) : 0;
        const x = s[0], y = s[1] - rpx - 8, w = L.w || (L.w = L.el.offsetWidth || 50);
        if (!boxes.some((b) => x - w / 2 < b[0] + b[2] && x + w / 2 > b[0] && y - 14 < b[1] && y > b[1] - 14)) {
          boxes.push([x - w / 2, y, w]); ok = true; L.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
        }
      }
      L.el.style.opacity = ok ? '1' : '0';
    }
  }
  const info = (title, sub, items) => { root.querySelector('h3').textContent = title; root.querySelector('.sub').textContent = sub; root.querySelector('ul').innerHTML = items.map((t) => `<li>${t}</li>`).join(''); };
  const bar = root.querySelector('.cu-bar');
  const button = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; bar.appendChild(b); return b; };
  let dead = false, raf = 0;
  const disposers = [];
  function destroy() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect();
    scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    disposers.forEach((f) => f()); renderer.dispose(); root.remove(); onClose?.();
  }
  root.querySelector('.cu-close').onclick = destroy;
  const loop = (fn) => { let last = performance.now(); const f = (now) => { if (dead) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; fn(dt, now); renderer.render(scene, camera); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); };
  return { root, renderer, scene, camera, st, addLabel, project, updateCamera, info, button, bar, loop, destroy, disposers, size: () => [W, H] };
}

// ── 3D 값 잡음(GLSL) ──
export const NOISE = `
float h31(vec3 p){ p = fract(p*0.3183099 + vec3(.1,.2,.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i=0;i<6;i++){ s += a*vnoise(p); p = p*2.03 + 1.7; a *= 0.5; } return s; }
`;

export const PLANET_VERT = `
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const PLANET_FRAG = `
uniform int uType; uniform vec3 uA, uB, uC, uLightPos, uAtm; uniform float uSeed, uTime, uHeat;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  vec3 p = vObj + uSeed;
  vec3 N = normalize(vN), L = normalize(uLightPos - vW), V = normalize(cameraPosition - vW);
  float lit = dot(N, L);
  float day = smoothstep(-0.08, 0.25, lit);
  vec3 col; vec3 emit = vec3(0.0); float spec = 0.0;
  if (uType == 0 || uType == 5) { // 가스 거인 · 뜨거운 목성: 띠 + 소용돌이
    float w = fbm(p*vec3(2.0,9.0,2.0) + vec3(uTime*0.02,0.0,0.0));
    float y = vObj.y + (w-0.5)*0.22 + 0.06*sin(vObj.x*9.0+uSeed);
    float band = 0.5 + 0.5*sin(y*(14.0+uSeed*0.4));
    col = mix(uA, uB, band); col = mix(col, uC, smoothstep(0.62, 0.8, fbm(p*5.0)) * 0.6);
    float storm = smoothstep(0.09, 0.0, length(vec2(atan(vObj.z, vObj.x)*0.35 - 0.6, vObj.y + 0.28)) ); col = mix(col, uC*1.1, storm*0.8);
    if (uType == 5) emit = vec3(1.0,0.32,0.08) * uHeat * (0.35 + 0.65*fbm(p*4.0)) * (1.0 - day*0.6);
  } else if (uType == 1) { // 얼음 거인(해왕성형)
    float w = fbm(p*vec3(2.0,6.0,2.0) + vec3(uTime*0.015,0.0,0.0));
    float band = 0.5 + 0.5*sin((vObj.y + (w-0.5)*0.3)*8.0);
    col = mix(uA, uB, band*0.55); col = mix(col, vec3(1.0), smoothstep(0.66, 0.78, fbm(p*6.0+3.0))*0.5);
    if (uHeat > 0.0) emit = vec3(1.0,0.4,0.15)*uHeat*0.4*(1.0-day);
  } else if (uType == 3) { // 바다 행성(상상): 대륙·바다·구름·극관
    float h = fbm(p*2.2);
    float land = smoothstep(0.52, 0.55, h);
    vec3 sea = mix(vec3(0.02,0.08,0.25), vec3(0.05,0.2,0.45), smoothstep(0.3,0.52,h));
    vec3 grd = mix(uA, uB, smoothstep(0.55, 0.75, h));
    col = mix(sea, grd, land); spec = (1.0-land);
    col = mix(col, vec3(0.95), smoothstep(0.72, 0.85, abs(vObj.y) + (h-0.5)*0.3));
    float cl = smoothstep(0.55, 0.75, fbm(p*3.0 + vec3(uTime*0.03, 0.0, uTime*0.01)));
    col = mix(col, vec3(1.0), cl*0.85);
  } else if (uType == 4) { // 용암 행성: 검은 껍질 + 빛나는 균열
    float h = fbm(p*3.0);
    float crack = pow(1.0 - abs(vnoise(p*7.0 + uTime*0.05)*2.0 - 1.0), 12.0);
    col = mix(uA, uB, h);
    emit = vec3(1.0, 0.35, 0.05) * (crack*1.6 + smoothstep(0.62,0.8,h)*0.8) * uHeat;
  } else if (uType == 6) { // 얼어붙은 암석
    float h = fbm(p*3.0); float cr = pow(1.0 - abs(vnoise(p*9.0)*2.0-1.0), 18.0);
    col = mix(uA, uB, h) - cr*0.25; spec = 0.3;
  } else { // 암석 행성: 지형·충돌구
    float h = fbm(p*2.6);
    float cr = smoothstep(0.6, 0.72, vnoise(p*7.0)) * 0.3 + smoothstep(0.66, 0.74, vnoise(p*15.0+4.0)) * 0.2;
    col = mix(uA, uB, smoothstep(0.35, 0.7, h)) * (1.0 - cr) + uC*smoothstep(0.7,0.85,h)*0.3;
  }
  vec3 Hh = normalize(L + V);
  float sp = pow(max(dot(N, Hh), 0.0), 60.0) * spec * day;
  vec3 c = col * (0.03 + 1.05*max(lit, 0.0)) + vec3(sp*0.8) + emit;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += uAtm * rim * (0.15 + 0.85*smoothstep(-0.3, 0.4, lit));
  gl_FragColor = vec4(c, 1.0);
}`;

export const STAR_FRAG = `
uniform vec3 uCol; uniform float uTime;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
  float mu = max(dot(N, V), 0.0);
  float g = fbm(vObj*14.0 + vec3(0.0, uTime*0.05, uTime*0.03));
  float spots = smoothstep(0.7, 0.78, fbm(vObj*3.0 + 9.0));
  vec3 c = uCol * (0.75 + 0.5*g) * (0.35 + 0.65*pow(mu, 0.45)) * (1.0 - spots*0.6);
  gl_FragColor = vec4(c*1.25, 1.0);
}`;

export function glowTexture(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.2, `rgba(${rgb},.45)`); gr.addColorStop(0.5, `rgba(${rgb},.12)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const fmtDays = (d) => (d < 2 ? `${(d * 24).toFixed(1)}시간` : d < 1000 ? `${d.toFixed(1)}일` : `${(d / 365.25).toFixed(1)}년`);

/** 행성 종류(관측값 → 대표 생김새). 크기·온도로만 판단한 상상도 */
function classify(p, star) {
  let T = p.teq, est = false;
  if (!T && star.tempK && p.au) { T = star.tempK * Math.sqrt(((star.radiusSun || 1) * 6.957e8) / (2 * p.au * 1.496e11)) * 0.915; est = true; }
  const re = p.reKnown === false ? null : p.re;
  const big = re ? re >= 6 : p.method === 'R' || p.method === 'I' || p.method === 'M';
  let type, ko;
  if (big) { type = T > 1000 ? 5 : 0; ko = T > 1000 ? '뜨거운 목성' : '가스 거인'; }
  else if (re && re >= 1.9) { type = 1; ko = re < 4 ? '미니 해왕성' : '해왕성형 얼음 거인'; }
  else if (T > 1000) { type = 4; ko = '용암 행성'; }
  else if (T >= 240 && T <= 340) { type = 3; ko = '바다가 있을 수도 있는 암석 행성'; }
  else if (T < 200) { type = 6; ko = '얼어붙은 암석 행성'; }
  else { type = 2; ko = '암석 행성'; }
  return { type, ko, T, est, re };
}
function planetMaterial(cls, name, starRgb) {
  const s = hash(name);
  const pal = {
    0: [[0.85, 0.72, 0.55], [0.62, 0.45, 0.32], [0.95, 0.9, 0.82], [0.5, 0.45, 0.35]],
    5: [[0.45, 0.22, 0.14], [0.25, 0.12, 0.1], [0.75, 0.42, 0.2], [0.8, 0.4, 0.2]],
    1: [[0.35, 0.62, 0.9], [0.2, 0.42, 0.78], [0.8, 0.9, 1.0], [0.4, 0.7, 1.0]],
    3: [[0.25, 0.42, 0.18], [0.55, 0.45, 0.32], [1, 1, 1], [0.35, 0.6, 1.0]],
    4: [[0.08, 0.06, 0.06], [0.2, 0.12, 0.1], [0.4, 0.2, 0.1], [0.9, 0.35, 0.1]],
    6: [[0.85, 0.9, 0.95], [0.6, 0.68, 0.78], [1, 1, 1], [0.6, 0.75, 1.0]],
    2: [[0.42, 0.36, 0.32], [0.62, 0.5, 0.4], [0.75, 0.65, 0.55], [0.0, 0.0, 0.0]],
  }[cls.type];
  // 조금씩 다르게
  const tint = (c) => new THREE.Vector3(...c.map((x, i) => Math.min(1, x * (0.85 + 0.3 * ((s * (i + 3) * 7.13) % 1)))));
  const heat = cls.T ? Math.max(0, Math.min(1.4, (cls.T - 700) / 900)) : 0;
  return new THREE.ShaderMaterial({
    uniforms: { uType: { value: cls.type }, uA: { value: tint(pal[0]) }, uB: { value: tint(pal[1]) }, uC: { value: tint(pal[2]) }, uAtm: { value: new THREE.Vector3(...pal[3]).multiplyScalar(cls.type === 2 || cls.type === 4 ? 0.15 : 0.55) },
      uLightPos: { value: new THREE.Vector3() }, uSeed: { value: s * 50 }, uTime: { value: 0 }, uHeat: { value: heat } },
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
  });
}

/**
 * 외계 행성계 3D
 * @param sys catalogToSystem / SYSTEMS 모양 { name, distLy, star:{type,radiusSun,tempK,color}, hz, planets:[{name,au,days,re,reKnown,teq,method,note}] }
 */
export function openSystem3D(host, { sys, focusPlanet = null, toEarth = 0, startDate = new Date(), onClose } = {}) {
  const S = makeShell(host, 'sys', onClose);
  const { scene, st } = S;
  const planets = sys.planets.slice().sort((a, b) => a.au - b.au);
  const maxAu = Math.max(...planets.map((p) => p.au));
  const K = 40 / maxAu;                                   // 궤도: 실제 비율
  const starTrue = (sys.star.radiusSun || 1) * 0.00465 * K;
  const starVis = Math.max(starTrue, 1.1);
  // 행성 크기: 보이도록 키움(서로 비율은 유지)
  const vis = planets.map((p) => 0.85 * Math.sqrt(p.reKnown === false ? (classify(p, sys.star).type === 0 ? 11 : 1.2) : p.re || 1));
  let prev = starVis;
  const R = planets.map((p, i) => { const r = Math.max(K * p.au, prev + vis[i] + (i ? vis[i - 1] : 0) + 0.4); prev = r; return r; });
  const squeezed = planets.some((p, i) => R[i] > K * p.au * 1.05);
  // 별
  const starRgb = sys.star.color || '255,236,200';
  const sc = starRgb.split(',').map((x) => Number(x) / 255);
  const starMat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Vector3(...sc) }, uTime: { value: 0 } }, vertexShader: PLANET_VERT, fragmentShader: STAR_FRAG });
  const star = new THREE.Mesh(new THREE.SphereGeometry(starVis, 64, 48), starMat); scene.add(star);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(starRgb), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(starVis * 7); scene.add(glow);
  S.addLabel(star, sys.name, '#fff2c8').rad = starVis;
  // 배경 별
  { const g = new THREE.BufferGeometry(), n = 2500, a = new Float32Array(n * 3); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) { const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, q = Math.sqrt(1 - z * z); a.set([q * Math.cos(t) * 3000, z * 3000, q * Math.sin(t) * 3000], i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(a, 3)); scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa3c0, size: 1.4, sizeAttenuation: false }))); }
  // 생명 가능 지대
  let hzMesh = null; const orbitLines = [];
  if (sys.hz && K * sys.hz[0] < 400) {
    hzMesh = new THREE.Mesh(new THREE.RingGeometry(K * sys.hz[0], K * sys.hz[1], 128), new THREE.MeshBasicMaterial({ color: 0x4fd1a5, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    hzMesh.rotation.x = -Math.PI / 2; scene.add(hzMesh);
    const lp = new THREE.Object3D(); lp.position.set(0, 0, -K * (sys.hz[0] + sys.hz[1]) / 2); scene.add(lp);
    S.addLabel(lp, '생명 가능 지대', '#7ee0c3');
  }
  // 행성
  const minDays = Math.min(...planets.map((p) => p.days));
  let rate = minDays / 14;                                // 1초에 흐르는 날 수(가장 안쪽 행성이 14초에 한 바퀴)
  const objs = planets.map((p, i) => {
    const cls = classify(p, sys.star);
    const full = p.name.length <= 3 ? `${sys.name} ${p.name}` : p.name;
    const mat = planetMaterial(cls, full, starRgb);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(vis[i], 64, 48), mat);
    mesh.rotation.z = 0.1 + hash(full + 'tilt') * 0.4;
    const pivot = new THREE.Object3D(); pivot.add(mesh); scene.add(pivot);
    // 타원 궤도(별이 초점) — 위치를 모르는 행성은 점선
    const st0 = exoStates(sys, startDate, toEarth).find((q) => q.name === full || q.short === p.name) || { ecc: 0, periDir: 0, exact: false };
    const ee = st0.ecc || 0, kk = R[i] / p.au;
    const orbitPts = Array.from({ length: 181 }, (_, k) => { const E = (k / 180) * Math.PI * 2; const nu = 2 * Math.atan2(Math.sqrt(1 + ee) * Math.sin(E / 2), Math.sqrt(1 - ee) * Math.cos(E / 2)); const r = p.au * (1 - ee * Math.cos(E)) * kk, a = st0.periDir + nu; return new THREE.Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r); });
    const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPts),
      st0.exact ? new THREE.LineBasicMaterial({ color: cls.type === 3 ? 0x7ee0c3 : 0x8fa0d8, transparent: true, opacity: 0.35 }) : new THREE.LineDashedMaterial({ color: 0x8fa0d8, transparent: true, opacity: 0.35, dashSize: R[i] * 0.04, gapSize: R[i] * 0.04 }));
    if (!st0.exact) orbit.computeLineDistances();
    scene.add(orbit); orbitLines.push(orbit);
    // 고리: 차가운 가스 거인에 가끔(상상)
    if (cls.type === 0 && hash(full + 'ring') > 0.6) {
      const rg = new THREE.Mesh(new THREE.RingGeometry(vis[i] * 1.3, vis[i] * 2.1, 96), new THREE.MeshBasicMaterial({ color: 0xd8c8a8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      rg.rotation.x = -Math.PI / 2; mesh.add(rg);
    }
    const lab = S.addLabel(mesh, p.name.length <= 3 ? p.name : full.replace(sys.name, '').trim() || full, cls.type === 3 ? '#9ff0d6' : '#dfe6ff');
    lab.rad = vis[i];
    return { p, i, cls, full, mesh, pivot, mat, lab, kk, exact: st0.exact, src: st0.src, ecc: ee, lock: p.days < 10 };
  });
  let simDays = 0, sel = null, speedIdx = 1;
  const SPEEDS = [0, 1, 4, 16];
  const setInfoSystem = () => {
    S.info(`${sys.name} 행성계`, `${sys.distLy < 1000 ? sys.distLy : Math.round(sys.distLy).toLocaleString('ko-KR')}광년 · ${sys.star.type || '별'}`, [
      `행성 ${planets.length}개 · 궤도 간격은 실제 비율${squeezed ? '(별에 너무 붙은 궤도만 살짝 벌림)' : ''}`,
      '행성·별 크기는 보이도록 키웠어요 · 행성을 탭하면 가까이 가요',
      '표면 모습은 크기·온도로 고른 상상도예요 (실제 사진 아님)',
    ]);
  };
  const setInfoPlanet = (o) => {
    const c = o.cls, p = o.p;
    const size = c.re ? (c.re > 6 ? `목성의 ${(c.re / 11.21).toFixed(1)}배` : `지구의 ${c.re.toFixed(1)}배`) : '크기 모름(시선속도법 등 · 대개 거대 행성)';
    S.info(o.full, `${c.ko} · 상상도`, [
      `별에서 ${p.au} AU · 공전 ${fmtDays(p.days)} · 크기 ${size}`,
      c.T ? `온도 약 ${Math.round(c.T - 273).toLocaleString('ko-KR')}°C${c.est ? ' (별 밝기로 추정)' : ''}` : '온도 모름',
      o.lock ? '조석 고정 추정: 늘 같은 면이 별을 봐요(영원한 낮·밤)' : '자전 주기는 아직 몰라요',
      o.ecc > 0.02 ? `타원 궤도 · 이심률 ${o.ecc.toFixed(2)} (별에 가장 가까울 때 ${(p.au * (1 - o.ecc)).toFixed(3)} AU, 멀 때 ${(p.au * (1 + o.ecc)).toFixed(3)} AU)` : '거의 원 궤도',
      o.src === 'transit' ? '궤도 위 위치: 실제(별 앞을 지난 기록으로 계산)' : o.src === 'periastron' ? '궤도 위 위치: 실제(근점 통과 기록으로 계산)' : '궤도 위 위치: 추정(아직 몰라서 임의로 둠 · 점선 궤도)',
      ...(p.note ? [p.note] : []),
      ...(p.year ? [`${p.year}년 발견`] : []),
    ]);
  };
  setInfoSystem();
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 휠/핀치로 확대 · 행성 탭하면 가까이';
  const bAll = S.button('전체', () => select(null));
  const pBtns = objs.map((o) => S.button(o.lab.el.textContent, () => select(o)));
  const spdBtn = S.button('', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; spdLabel(); });
  const spdLabel = () => { const k = SPEEDS[speedIdx]; spdBtn.textContent = k ? `1초 = ${fmtDays(rate * k)}` : '멈춤'; };
  spdLabel();
  function select(o) {
    sel = o;
    bAll.classList.toggle('on', !o); pBtns.forEach((b, i) => b.classList.toggle('on', objs[i] === o));
    if (!o) { st.goalT = () => new THREE.Vector3(); st.goalD = 95; setInfoSystem(); return; }
    st.goalT = () => o.mesh.getWorldPosition(new THREE.Vector3()); st.goalD = vis[o.i] * 4.2; setInfoPlanet(o);
  }
  st.dist = 95; st.pitch = 0.42; st.minD = 0.3; st.maxD = 600;
  if (focusPlanet) { const o = objs.find((q) => q.p.name === focusPlanet || q.full === focusPlanet); if (o) setTimeout(() => select(o), 300); else select(null); } else select(null);
  const rc = new THREE.Raycaster();
  S.loop((dt, now) => {
    simDays += dt * rate * SPEEDS[speedIdx];
    const t = now / 1000;
    starMat.uniforms.uTime.value = t;
    const sts = exoStates(sys, new Date(startDate.getTime() + simDays * 86400000), toEarth);
    for (const o of objs) {
      const q = sts[sys.planets.indexOf(o.p)] || sts[o.i];
      const a = q.angle, rr = q.rAU * o.kk;
      o.mesh.position.set(Math.cos(a) * rr, 0, -Math.sin(a) * rr);
      o.mesh.rotation.y = o.lock ? a + Math.PI : t * 0.15 + o.i;
      o.mat.uniforms.uTime.value = t; o.mat.uniforms.uLightPos.value.set(0, 0, 0);
    }
    if (st.tap) {
      const [W, H] = S.size(); rc.setFromCamera(new THREE.Vector2((st.tap[0] / W) * 2 - 1, -(st.tap[1] / H) * 2 + 1), S.camera);
      let best = null;
      for (const o of objs) { const wp = o.mesh.getWorldPosition(new THREE.Vector3()); const s = S.project(wp); if (!s) continue; const d = Math.hypot(s[0] - st.tap[0], s[1] - st.tap[1]); if (d < 26 && (!best || d < best.d)) best = { o, d }; }
      const hits = rc.intersectObjects(objs.map((o) => o.mesh));
      if (hits.length) best = { o: objs.find((q) => q.mesh === hits[0].object) };
      if (best) select(best.o);
      st.tap = null;
    }
    // 가까이 가면 궤도선·생명 가능 지대 면이 행성을 가르지 않도록 흐리게
    const near = sel ? Math.min(1, Math.max(0, (st.dist / (vis[sel.i] * 14)) - 0.3)) : 1;
    if (hzMesh) hzMesh.material.opacity = 0.13 * near;
    for (const l of orbitLines) l.material.opacity = 0.35 * near;
    S.updateCamera(dt);
  });
  return { destroy: S.destroy };
}

// ───────────── 인공위성·잔해 생김새 ─────────────
function panelTexture(base, line) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128); g.strokeStyle = line; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (let y = 0; y <= 128; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function foilTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#c9952e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 4 + Math.random() * 18; g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,220,140' : '110,70,20'},${0.08 + Math.random() * 0.2})`; g.beginPath(); g.ellipse(x, y, r, r * 0.4, Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildSat(kind, name) {
  const grp = new THREE.Group();
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.35, ...o });
  const white = M({ color: 0xd9dde2, roughness: 0.6, metalness: 0.2 }), grey = M({ color: 0x8a9099 }), foil = M({ map: foilTexture(), metalness: 0.7, roughness: 0.35 });
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); grp.add(o); return o; };
  const cyl = (r, l, m, axis, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 32), m); if (axis === 'x') o.rotation.z = Math.PI / 2; if (axis === 'z') o.rotation.x = Math.PI / 2; o.position.set(x, y, z); grp.add(o); return o; };
  const panel = (w, h, tex, x, y, z, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, h), [grey, grey, M({ map: tex, metalness: 0.5, roughness: 0.3 }), M({ color: 0x334, roughness: 0.8 }), grey, grey]); o.position.set(x, y, z); o.rotation.y = ry; grp.add(o); return o; };
  let size = '', real = 1.8, note = '';
  if (/^ISS/.test(name)) {
    // 국제우주정거장: 트러스 109m · 태양 전지판 8쌍(금빛) · 모듈 줄기
    const gold = panelTexture('#8a5a1c', '#3a2408');
    box(100, 2.5, 2.5, grey);
    for (const sx of [-1, 1]) for (const [ox, oz] of [[34, 1], [34, -1], [46, 1], [46, -1]]) panel(11.6, 34, gold, sx * ox, 0, oz * 19.5);
    cyl(2.1, 52, white, 'z', 0, -3.5, 0); cyl(2.1, 14, white, 'x', 0, -3.5, 16); cyl(2.2, 12, white, 'x', 0, -3.5, -18);
    for (const sx of [-1, 1]) box(13, 0.15, 3.2, white, sx * 14, 0, 6);
    size = '약 109m × 73m · 무게 약 420톤'; real = 109; note = '1998년부터 조립 · 사람이 상주하는 유일한 다국적 정거장';
  } else if (/^(CSS|TIANHE|TIANGONG)/.test(name)) {
    const blue = panelTexture('#1d2a66', '#0a1030');
    cyl(2.1, 17, white, 'z'); cyl(2.1, 18, white, 'x', -9, 0, 8.5); cyl(2.1, 18, white, 'x', 9, 0, 8.5);
    for (const sx of [-1, 1]) { panel(27, 4.2, blue, sx * 22, 0, 8.5); panel(12, 4, blue, sx * 7, 0, -4); }
    size = '약 55m × 30m · 무게 약 100톤'; real = 55; note = '중국 우주정거장(톈궁) · 2022년 완성';
  } else if (kind === 'starlink') {
    const blue = panelTexture('#141c4a', '#2a3a80');
    box(4.1, 0.3, 2.7, M({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 }));
    panel(12.5, 2.7, blue, -8.4, 0.2, 0); panel(12.5, 2.7, blue, 8.4, 0.2, 0);
    size = '본체 약 4m × 3m · 전지판 펼치면 약 30m'; real = 30; note = '납작한 상자를 겹겹이 쌓아 한 번에 수십 기 발사 · 수천 기가 하늘을 덮어요';
  } else if (kind === 'debris' || /DEB|R\/B/.test(name)) {
    if (/R\/B/.test(name)) { // 로켓 상단
      cyl(1.3, 9, white); const noz = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 32, 1, true), M({ color: 0x3a3a3a, side: THREE.DoubleSide, metalness: 0.8 })); noz.position.y = -5.4; grp.add(noz);
      const ring = cyl(1.32, 0.3, grey); ring.position.y = 3;
      size = '대략 길이 9m · 지름 2.6m (로켓 상단 대표 모양)'; real = 9; note = '임무 뒤 궤도에 남은 로켓 상단 · 연료가 남으면 폭발해 파편이 되기도 해요';
    } else { // 파편 조각
      const g = new THREE.IcosahedronGeometry(0.4, 2), pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const k = 0.5 + Math.abs(Math.sin(x * 9 + y * 7) * Math.cos(z * 11)) * 0.9; pa.setXYZ(i, x * k * 1.6, y * k * 0.35, z * k); }
      g.computeVertexNormals();
      const frag = new THREE.Mesh(g, [foil][0]); grp.add(frag);
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.3), M({ map: panelTexture('#1d2a66', '#0a1030') })); shard.position.set(0.35, 0.1, 0.2); shard.rotation.set(0.4, 0.6, 0.2); grp.add(shard);
      size = '대략 수십 cm (추적되는 파편은 보통 10cm 이상)'; real = 0.8; note = '초속 7~8km — 1cm 조각도 총알보다 훨씬 강한 충격 · 1~10cm 파편은 100만 개 넘게 있을 거로 추정';
    }
  } else { // 일반 인공위성
    const blue = panelTexture('#15204f', '#33458f');
    box(2, 2, 2.4, foil);
    for (const sx of [-1, 1]) { cyl(0.05, 1.2, grey, 'x', sx * 1.6, 0, 0); panel(5.5, 2, blue, sx * 5, 0, 0); }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 12, 0, Math.PI * 2, 0, 0.9), M({ color: 0xeeeeee, side: THREE.DoubleSide, roughness: 0.4 })); dish.rotation.x = Math.PI; dish.position.y = -1.7; grp.add(dish);
    cyl(0.03, 1.5, grey, null, 0.6, 1.7, 0.6);
    size = '대표 모양 · 본체 약 2m, 전지판 포함 약 14m'; real = 14; note = '금빛은 열을 막는 단열 포일(MLI) · 파란 판은 태양 전지';
  }
  return { grp, size, real, note };
}

/**
 * 인공위성·우주정거장·파편 가까이 보기
 * @param q { name, kind, id, year, alt, vel, desc }
 */
export function openObject3D(host, { q, onClose } = {}) {
  const S = makeShell(host, 'sat', onClose);
  const { scene, st } = S;
  S.renderer.setClearColor(0x000000, 0);
  scene.add(new THREE.AmbientLight(0x334466, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(5, 3, 4); scene.add(sun);
  const earthLight = new THREE.DirectionalLight(0x5a9be0, 0.9); earthLight.position.set(0, -6, 0); scene.add(earthLight);
  const { grp, size, real, note } = buildSat(q.kind, q.name || '');
  scene.add(grp);
  // 크기 비교: 사람(1.8m)
  const human = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x3dff8f, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 12), hm); body.position.y = 0.7; human.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), hm); head.position.y = 1.55; human.add(head);
  human.position.set(real * 0.45 + 1.2, -0.9, -real * 0.2 - 0.6); scene.add(human);
  S.addLabel(human, '사람 1.8m', '#3dff8f').rad = 1;
  const debris = q.kind === 'debris' || /DEB/.test(q.name || '');
  // 파편 구름(모형): 같은 사건에서 나온 조각들이 궤도를 따라 퍼져 나가는 모습
  let cloud = null;
  if (debris && !/R\/B/.test(q.name || '')) {
    const n = 500, g = new THREE.TetrahedronGeometry(0.06, 0);
    cloud = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xb0a080, metalness: 0.6, roughness: 0.4 }), n);
    const m = new THREE.Matrix4(), e = new THREE.Euler(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
    cloud.userData.v = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, r = 2 + Math.random() * 14;
      const p = new THREE.Vector3(u * 30, (Math.random() - 0.5) * r * 0.25, (Math.random() - 0.5) * r * 0.5);
      if (p.length() < 6) p.setLength(6 + Math.random() * 4);
      e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); qq.setFromEuler(e); sc.setScalar(0.3 + Math.random() * 1.2);
      m.compose(p, qq, sc); cloud.setMatrixAt(i, m); cloud.userData.v.push([p, qq.clone(), sc.clone(), new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * 2]);
    }
    scene.add(cloud);
  }
  const tumble = debris || /R\/B/.test(q.name || '');
  const kindKo = /R\/B/.test(q.name || '') ? '로켓 잔해' : debris ? '우주쓰레기(파편)' : q.kind === 'station' ? '우주정거장' : q.kind === 'starlink' ? '스타링크 위성' : '인공위성';
  S.info(q.name || kindKo, `${kindKo} · 생김새는 종류별 대표 모형`, [
    q.alt ? `지금 고도 약 ${Math.round(q.alt).toLocaleString('ko-KR')}km · 초속 ${q.vel ? q.vel.toFixed(2) : '7.7'}km` : '저궤도',
    `크기: ${size}`,
    note,
    ...(q.desc ? [q.desc] : []),
    ...(cloud ? ['주변 작은 점들은 같은 사건에서 나온 파편 구름(모형) · 실제 간격은 수 km~수천 km'] : []),
  ].filter(Boolean));
  S.root.querySelector('.cu-note').textContent = '드래그로 돌리기 · 휠/핀치로 확대' + (tumble ? ' · 제어를 잃고 빙글빙글 도는 중' : '');
  st.dist = real * 1.6 + 3; st.minD = real * 0.15 + 0.3; st.maxD = Math.max(80, real * 8); st.pitch = 0.3; st.yaw = 0.7;
  const bView = [S.button('전체 모습', () => { st.goalD = real * 1.6 + 3; bView.forEach((b, i) => b.classList.toggle('on', i === 0)); }), S.button('가까이', () => { st.goalD = real * 0.45 + 0.6; bView.forEach((b, i) => b.classList.toggle('on', i === 1)); })];
  if (cloud) bView.push(S.button('파편 구름', () => { st.goalD = 70; bView.forEach((b, i) => b.classList.toggle('on', i === 2)); }));
  bView[0].classList.add('on');
  const m = new THREE.Matrix4(), dq = new THREE.Quaternion();
  S.loop((dt, now) => {
    const t = now / 1000;
    if (tumble) { grp.rotation.x += dt * 0.35; grp.rotation.y += dt * 0.22; }
    else grp.rotation.y = Math.sin(t * 0.1) * 0.15;
    if (performance.now() - st.lastAct > 2500) st.yaw += dt * 0.08;
    if (cloud) {
      cloud.userData.v.forEach(([p, qq, sc, ax, w], i) => { dq.setFromAxisAngle(ax, dt * w); qq.premultiply(dq); p.x += dt * 0.25 * Math.sign(p.x || 1) * (0.2 + Math.abs(p.x) / 30); if (Math.abs(p.x) > 32) p.x = -Math.sign(p.x) * 6; m.compose(p, qq, sc); cloud.setMatrixAt(i, m); });
      cloud.instanceMatrix.needsUpdate = true;
    }
    st.tap = null;
    S.updateCamera(dt);
  });
  return { destroy: S.destroy };
}
