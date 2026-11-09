// 블랙홀 체험: 슈바르츠실트 블랙홀 주위 빛의 경로를 화면의 픽셀마다 계산(광선 추적)
// 단위: 슈바르츠실트 반지름 rs = 1. 광자 궤도 r = 1.5, 최소 안정 궤도(ISCO) r = 3.
// 광자 경로: d²x/dλ² = -1.5·h²·x/r⁵ (h = |x × v|) — 일반상대론 궤도 방정식과 같은 휘어짐
import * as THREE from 'three';

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform vec3 uCam; uniform mat3 uRot; uniform float uTime; uniform float uDisk; uniform float uHot; uniform float uFov;
varying vec2 vUv;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec3 stars(vec3 d){
  vec3 col = vec3(0.0);
  // 은하수 띠
  float band = exp(-pow(d.y*3.2 + 0.25*sin(d.x*3.0),2.0));
  col += vec3(0.45,0.42,0.55)*band*0.35;
  for (int k=0;k<3;k++){
    float sc = 90.0 + float(k)*140.0;
    vec3 p = d*sc; vec3 c = floor(p); vec3 f = fract(p)-0.5;
    float h = hash(c+float(k)*13.0);
    if (h > 0.985 - band*0.02){ float b = smoothstep(0.32,0.0,length(f)); col += mix(vec3(1.0,0.85,0.7),vec3(0.7,0.8,1.0),hash(c+5.0))*b*(h-0.98)*60.0; }
  }
  return col;
}
vec3 bb(float t){ // 온도(0~1) → 색
  return clamp(vec3(1.0, 0.45+0.55*t, 0.15+0.85*t*t)*(0.6+0.8*t), 0.0, 4.0);
}
void main(){
  vec2 uv = (vUv*2.0-1.0)*vec2(uRes.x/uRes.y,1.0)*uFov;
  vec3 dir = normalize(uRot*vec3(uv,-1.0));
  vec3 pos = uCam;
  vec3 vel = dir;
  vec3 h3 = cross(pos, vel); float h2 = dot(h3,h3);
  vec3 col = vec3(0.0); float alpha = 1.0;
  for (int i=0;i<420;i++){
    float r = length(pos);
    if (r < 1.0){ alpha = 0.0; break; }              // 사건의 지평선
    float dt = clamp(0.06*r, 0.02, 1.2);
    vec3 acc = -1.5*h2*pos/pow(r,5.0);
    vec3 np = pos + vel*dt + 0.5*acc*dt*dt;
    vel += acc*dt;
    // 원반(적도면 y=0) 통과
    if (uDisk > 0.0 && pos.y*np.y < 0.0){
      float t = pos.y/(pos.y-np.y); vec3 hit = mix(pos,np,t); float rr = length(hit.xz);
      if (rr > 3.0 && rr < 14.0){
        float temp = pow(3.0/rr, 0.75);
        vec3 vdisk = normalize(vec3(-hit.z,0.0,hit.x))*sqrt(0.5/rr);       // 케플러 속도(광속 단위)
        float g = sqrt(1.0-1.5/rr) / (1.0 - dot(vdisk, normalize(-vel))); // 도플러 + 중력 적색이동(근사)
        float ring = 0.75+0.25*sin(rr*6.0 - uTime*2.0/rr + atan(hit.z,hit.x)*3.0);
        float edge = smoothstep(3.0,3.6,rr)*smoothstep(14.0,10.0,rr);
        vec3 c = bb(clamp(temp*g*uHot,0.0,1.0)) * pow(g,3.0) * ring * edge * 1.6;
        col += c*alpha; alpha *= 0.15;
        if (alpha < 0.02) break;
      }
    }
    pos = np;
    if (r > 60.0 && dot(pos,vel) > 0.0) break;
  }
  col += stars(normalize(vel))*alpha;
  col = col/(1.0+col);                 // 톤매핑
  gl_FragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;

export const BH_TARGETS = {
  sgra: { name: '궁수자리 A*', sub: '우리은하 중심 · 2만 6,670광년', facts: ['질량: 태양의 약 430만 배', '사건의 지평선 지름: 약 2,500만 km (수성 궤도 안쪽 크기)', '2022년 EHT가 그림자를 처음 촬영 · 지금은 아주 조용히 먹는 중'], disk: 0.6, hot: 0.7 },
  m87: { name: 'M87*', sub: '처녀자리 은하단 · 5,500만 광년', facts: ['질량: 태양의 약 65억 배', '사건의 지평선 지름: 약 400억 km (태양계보다 큼)', '2019년 인류가 처음 찍은 블랙홀 사진의 주인공'], disk: 1.0, hot: 0.55 },
  cygx1: { name: '백조자리 X-1', sub: '7,200광년 · 짝별에서 가스를 빨아들임', facts: ['질량: 태양의 약 21배', '사건의 지평선 지름: 약 120km', '원반이 수백만 도로 뜨거워 X선으로 빛남'], disk: 1.0, hot: 1.25 },
  gaiabh3: { name: '가이아 BH3', sub: '1,926광년 · 조용한 블랙홀', facts: ['질량: 태양의 약 33배 (우리은하 별 블랙홀 중 최대)', '먹는 가스가 없어 원반이 없음 — 별빛이 휘는 것만 보여요', '2024년 Gaia가 짝별의 흔들림으로 찾음'], disk: 0, hot: 1 },
};

const CSS = `
.bh-root{position:absolute;inset:0;z-index:30;background:#000;touch-action:none;overflow:hidden}
.bh-root canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
.bh-info{position:absolute;top:10px;left:10px;right:58px;max-width:520px;padding:10px 12px;z-index:2;pointer-events:none}
.bh-info h3{margin:0;color:var(--g);font-size:16px;letter-spacing:.05em;text-shadow:var(--glow)}
.bh-info .sub{color:var(--gd);font-size:11px;margin-top:2px}
.bh-info ul{margin:6px 0 0;padding-left:16px;color:var(--gd);font-size:11.5px;line-height:1.55}
.bh-bar{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 10px calc(10px + env(safe-area-inset-bottom));z-index:2;
  background:linear-gradient(transparent,rgba(1,6,4,.92) 40%)}
.bh-bar button,.bh-close{border:1px solid var(--g2);background:rgba(1,22,11,.78);color:var(--g);font-family:inherit;font-weight:700;font-size:11.5px;cursor:pointer;
  text-shadow:var(--glow);padding:7px 10px;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.bh-bar button.on{background:rgba(61,255,143,.28);color:#eafff2}
.bh-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0;z-index:3}
.bh-note{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(64px + env(safe-area-inset-bottom));z-index:2;font-size:10.5px;color:var(--gd);white-space:nowrap;text-shadow:0 0 4px #000;pointer-events:none}
`;

export function openBlackHole(host, { target = 'sgra', onClose, sound } = {}) {
  if (!document.getElementById('bh-style')) { const st = document.createElement('style'); st.id = 'bh-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div');
  root.className = 'bh-root';
  root.innerHTML = `<div class="bh-info mu-frame"><h3></h3><div class="sub"></div><ul></ul></div><button class="bh-close" aria-label="닫기">✕</button>
    <div class="bh-note">드래그로 돌리기 · 휠/핀치로 다가가기 · 광선 추적으로 빛의 휘어짐을 직접 계산</div><div class="bh-bar"></div>`;
  host.appendChild(root);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uni = { uRes: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Vector3() }, uRot: { value: new THREE.Matrix3() }, uTime: { value: 0 }, uDisk: { value: 1 }, uHot: { value: 1 }, uFov: { value: 0.75 } };
  const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }', fragmentShader: FRAG });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  let yaw = 0.4, pitch = 0.13, dist = 22, cur = target, scale = 0.6;
  const bar = root.querySelector('.bh-bar');
  for (const [k, t] of Object.entries(BH_TARGETS)) {
    const b = document.createElement('button'); b.textContent = t.name; b.dataset.k = k;
    b.onclick = () => set(k); bar.appendChild(b);
  }
  function set(k) {
    cur = k; const t = BH_TARGETS[k];
    root.querySelector('h3').textContent = `블랙홀 체험 · ${t.name}`;
    root.querySelector('.sub').textContent = t.sub;
    root.querySelector('ul').innerHTML = t.facts.map((f) => `<li>${f}</li>`).join('') + '<li>위아래로 보이는 고리는 원반 뒤쪽이 휘어진 빛 · 한쪽이 더 밝은 건 다가오는 쪽 빛이 강해지는 도플러 효과</li>';
    uni.uDisk.value = t.disk; uni.uHot.value = t.hot;
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    sound?.blackhole?.(true);
  }
  set(BH_TARGETS[target] ? target : 'sgra');
  const ptr = new Map(); let pinch = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); });
  cv.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    const p = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 1) { yaw -= (e.clientX - p[0]) * 0.005; pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - p[1]) * 0.005)); }
    else { const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) dist = Math.max(4, Math.min(80, dist * (pinch / d))); pinch = d; }
  });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(4, Math.min(80, dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  // 느린 기기면 해상도 낮춤
  let fpsT = performance.now(), frames = 0;
  function resize() {
    const w = root.clientWidth || 1, h = root.clientHeight || 1;
    renderer.setPixelRatio(scale); renderer.setSize(w, h, false);
    uni.uRes.value.set(w, h);
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  let raf = 0, dead = false;
  const t0 = performance.now();
  function frame(now) {
    const c = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dist);
    uni.uCam.value.copy(c);
    const m = new THREE.Matrix4().lookAt(c, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    uni.uRot.value.setFromMatrix4(m);
    uni.uTime.value = (now - t0) / 1000;
    if (!ptr.size) yaw += 0.0015;
    renderer.render(scene, cam);
    frames++;
    if (now - fpsT > 1500) { const fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; const ns = fps < 24 ? Math.max(0.3, scale * 0.8) : fps > 50 ? Math.min(1, scale * 1.15) : scale; if (Math.abs(ns - scale) > 0.04) { scale = ns; resize(); } }
    if (!dead) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function destroy() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect();
    mat.dispose(); renderer.dispose(); root.remove(); sound?.blackhole?.(false); onClose?.();
  }
  root.querySelector('.bh-close').onclick = destroy;
  return { destroy };
}
