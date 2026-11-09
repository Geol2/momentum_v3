// 블랙홀 체험: 슈바르츠실트 블랙홀 주위 빛의 경로를 화면의 픽셀마다 계산(광선 추적)
// 단위: 슈바르츠실트 반지름 rs = 1. 광자 궤도 r = 1.5, 최소 안정 궤도(ISCO) r = 3.
// 광자 경로: d²x/dλ² = -1.5·h²·x/r⁵ (h = |x × v|) — 일반상대론 궤도 방정식과 같은 휘어짐
import * as THREE from 'three';

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform vec3 uCam; uniform mat3 uRot; uniform float uTime; uniform float uDisk; uniform float uHot; uniform float uFov; uniform float uJet;
varying vec2 vUv;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n2(p); p*=2.03; a*=0.5; } return v; }
vec3 stars(vec3 d){
  vec3 col = vec3(0.0);
  float band = exp(-pow(d.y*3.0 + 0.25*sin(d.x*3.0),2.0));
  col += vec3(0.42,0.40,0.55)*band*(0.18+0.25*fbm(d.xz*6.0+d.y*3.0));
  for (int k=0;k<4;k++){
    float sc = 120.0 + float(k)*170.0;
    vec3 p = d*sc; vec3 c = floor(p); vec3 f = fract(p)-0.5;
    float h = hash(c+float(k)*13.0);
    if (h > 0.987 - band*0.02){ float b = smoothstep(0.18,0.0,length(f)); col += mix(vec3(1.0,0.82,0.65),vec3(0.7,0.82,1.0),hash(c+5.0))*b*(h-0.982)*90.0; }
  }
  return col;
}
vec3 bb(float t){ // 온도(0~1) → 색 (붉은색 → 흰색 → 푸른 흰색)
  t = clamp(t,0.0,1.4);
  vec3 c = mix(vec3(1.0,0.32,0.05), vec3(1.0,0.78,0.45), smoothstep(0.0,0.45,t));
  c = mix(c, vec3(1.0,0.97,0.92), smoothstep(0.45,0.85,t));
  c = mix(c, vec3(0.75,0.85,1.0), smoothstep(0.85,1.4,t));
  return c*(0.35+1.4*t);
}
void main(){
  vec2 uv = (vUv*2.0-1.0)*vec2(uRes.x/uRes.y,1.0)*uFov;
  vec3 dir = normalize(uRot*vec3(uv,-1.0));
  vec3 pos = uCam, vel = dir;
  vec3 h3 = cross(pos, vel); float hh = dot(h3,h3);
  vec3 col = vec3(0.0); float alpha = 1.0;
  for (int i=0;i<900;i++){
    float r = length(pos);
    if (r < 1.0){ alpha = 0.0; break; }                                 // 사건의 지평선
    float dt = clamp(0.035*r*r/(r+2.0), 0.008, 1.5);                     // 블랙홀 가까이에서 촘촘히
    vec3 acc = -1.5*hh*pos/pow(r,5.0);
    vec3 np = pos + vel*dt + 0.5*acc*dt*dt;
    vec3 nacc = -1.5*hh*np/pow(length(np),5.0);
    vel += 0.5*(acc+nacc)*dt;                                           // 속도 베를레
    // 제트(회전축 방향 플라스마 분출)
    if (uJet > 0.0){
      float ay = abs(np.y), rho2 = dot(np.xz,np.xz), w = 0.35+0.09*ay;
      if (ay > 1.6 && ay < 70.0) col += alpha*vec3(0.55,0.75,1.0)*uJet*exp(-rho2/(w*w))*dt*0.45*(0.6+0.4*n2(vec2(ay*1.5 - uTime*3.0, 0.0)))/(1.0+ay*0.04);
    }
    // 강착원반(적도면 y=0) 통과
    if (uDisk > 0.0 && pos.y*np.y < 0.0){
      float t = pos.y/(pos.y-np.y); vec3 hit = mix(pos,np,t); float rr = length(hit.xz);
      if (rr > 3.0 && rr < 16.0){
        float ang = atan(hit.z,hit.x);
        float om = 1.0/pow(rr,1.5);                                      // 케플러 각속도
        float tur = fbm(vec2(rr*2.2, (ang - uTime*om*2.5)*3.2));         // 소용돌이 무늬
        float streak = 0.55 + 0.75*tur*tur;
        float temp = pow(3.0/rr, 0.75)*(0.85+0.3*tur);
        vec3 vdisk = normalize(vec3(-hit.z,0.0,hit.x))*sqrt(0.5/rr);
        float g = sqrt(1.0-1.5/rr) / (1.0 - dot(vdisk, normalize(-vel))); // 도플러 + 중력 적색이동
        float edge = smoothstep(3.0,3.25,rr)*smoothstep(16.0,9.0,rr);
        vec3 c = bb(temp*g*uHot) * pow(g,3.0) * streak * edge * 1.7 * uDisk;
        col += c*alpha; alpha *= 0.12;
        if (alpha < 0.01) break;
      }
    }
    pos = np;
    if (r > 80.0 && dot(pos,vel) > 0.0) break;
  }
  col += stars(normalize(vel))*alpha;
  col = vec3(1.0) - exp(-col*1.1);                                     // 톤매핑(노출)
  gl_FragColor = vec4(pow(col, vec3(0.9)), 1.0);
}`;

export const BH_TARGETS = {
  sgra: { name: '궁수자리 A*', sub: '우리은하 중심 · 2만 6,670광년', facts: ['질량: 태양의 약 430만 배', '사건의 지평선 지름: 약 2,500만 km (수성 궤도 안쪽 크기)', '2022년 EHT가 그림자를 처음 촬영 · 지금은 아주 조용히 먹는 중', 'S2 별이 16년마다 공전 — 2020 노벨 물리학상'], disk: 0.55, hot: 0.75, jet: 0 },
  lmc: { name: '대마젤란 은하 중심', sub: '16만 광년 · 우리은하 바로 옆 은하', facts: ['질량: 태양의 약 60만 배 (2025년 발표)', '보이지 않지만, 이곳에서 튕겨 나온 초고속 별들로 찾아냄', '가스를 거의 안 먹어 원반 없이 조용함'], disk: 0, hot: 1, jet: 0 },
  m31: { name: '안드로메다 M31*', sub: '250만 광년 · 이웃 큰 은하', facts: ['질량: 태양의 약 1억 4천만 배 (궁수자리 A*의 약 30배)', '주위를 젊은 푸른 별 원반(P3)이 돌고 있어요', '약 45억 년 뒤 우리은하와 충돌하면 두 블랙홀도 합쳐질 수 있어요'], disk: 0.35, hot: 0.65, jet: 0 },
  m33: null,
  cena: { name: '센타우루스 A', sub: '1,200만 광년 · 가장 가까운 전파은하', facts: ['질량: 태양의 약 5,500만 배', '100만 광년 넘게 뻗은 제트와 전파 로브', '은하끼리 합쳐지며 가스를 먹는 중'], disk: 0.9, hot: 0.9, jet: 0.8 },
  m87: { name: 'M87*', sub: '처녀자리 은하단 · 5,500만 광년', facts: ['질량: 태양의 약 65억 배', '사건의 지평선 지름: 약 400억 km (태양계보다 큼)', '2019년 인류가 처음 찍은 블랙홀 사진 · 5천 광년 길이의 제트'], disk: 1.0, hot: 0.55, jet: 1.0 },
  holm15a: { name: '홈베리 15A', sub: 'Abell 85 은하단 · 약 7억 광년', facts: ['질량: 태양의 약 400억 배 — 별 움직임으로 직접 잰 것 중 최대급(2019)', '은하 중심이 텅 빈 듯 흐린 거대 타원은하', '지금은 조용함'], disk: 0.25, hot: 0.4, jet: 0 },
  ton618: { name: 'TON 618', sub: '퀘이사 · 빛이 108억 년 걸려 옴', facts: ['질량: 태양의 약 400억~660억 배 (알려진 최대급)', '은하 전체보다 140조 배 밝게 빛나던 퀘이사', '사건의 지평선이 태양계(해왕성 궤도)의 수십 배'], disk: 1.4, hot: 0.85, jet: 0.6 },
  cygx1: { name: '백조자리 X-1', sub: '7,200광년 · 짝별에서 가스를 빨아들임', facts: ['질량: 태양의 약 21배', '사건의 지평선 지름: 약 120km', '원반이 수백만 도로 뜨거워 X선으로 빛남'], disk: 1.0, hot: 1.25, jet: 0.35 },
  gaiabh3: { name: '가이아 BH3', sub: '1,926광년 · 조용한 블랙홀', facts: ['질량: 태양의 약 33배 (우리은하 별 블랙홀 중 최대)', '먹는 가스가 없어 원반이 없음 — 별빛이 휘는 것만 보여요', '2024년 Gaia가 짝별의 흔들림으로 찾음'], disk: 0, hot: 1, jet: 0 },
  omegacen: { name: '오메가 센타우리 중심', sub: '1만 7천 광년 · 구상성단', facts: ['질량: 태양의 최소 8,200배 — 「중간질량 블랙홀」 (2024)', '별 7개가 탈출 속도보다 빨리 움직이는 걸로 찾아냄', '먹힌 왜소은하의 중심이었을 가능성'], disk: 0, hot: 1, jet: 0 },
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
.bh-note{flex-basis:100%;text-align:center;font-size:10.5px;color:var(--gd);text-shadow:0 0 4px #000;pointer-events:none;margin-bottom:2px}
`;

export function openBlackHole(host, { target = 'sgra', onClose, sound } = {}) {
  if (!document.getElementById('bh-style')) { const st = document.createElement('style'); st.id = 'bh-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div');
  root.className = 'bh-root';
  root.innerHTML = `<div class="bh-info mu-frame"><h3></h3><div class="sub"></div><ul></ul></div><button class="bh-close" aria-label="닫기">✕</button>
    <div class="bh-bar"><div class="bh-note">드래그로 돌리기 · 휠/핀치로 다가가기 · 멈추면 최고 해상도로 다시 계산해 선명해져요</div></div>`;
  host.appendChild(root);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uni = { uRes: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Vector3() }, uRot: { value: new THREE.Matrix3() }, uTime: { value: 0 }, uDisk: { value: 1 }, uHot: { value: 1 }, uFov: { value: 0.75 }, uJet: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }', fragmentShader: FRAG });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  let yaw = 0.4, pitch = 0.13, dist = 22, cur = target, scale = 1, moveScale = 1;
  let lastAct = performance.now(), lastRender = 0, sharp = false;
  const bar = root.querySelector('.bh-bar');
  for (const [k, t] of Object.entries(BH_TARGETS)) {
    if (!t) continue;
    const b = document.createElement('button'); b.textContent = t.name; b.dataset.k = k;
    b.onclick = () => set(k); bar.appendChild(b);
  }
  function set(k) {
    cur = k; const t = BH_TARGETS[k];
    root.querySelector('h3').textContent = `블랙홀 체험 · ${t.name}`;
    root.querySelector('.sub').textContent = t.sub;
    root.querySelector('ul').innerHTML = t.facts.map((f) => `<li>${f}</li>`).join('') + '<li>' + (t.disk ? '위아래 고리는 원반 뒤쪽이 휘어진 빛 · 한쪽이 더 밝은 건 다가오는 쪽 빛이 강해지는 도플러 효과' : '검은 그림자 둘레로 별빛이 고리처럼 휘어 보여요(중력 렌즈)') + '</li>';
    uni.uDisk.value = t.disk; uni.uHot.value = t.hot; uni.uJet.value = t.jet || 0;
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    sound?.blackhole?.(true);
    lastAct = performance.now() - 400;
  }
  set(BH_TARGETS[target] ? target : 'sgra');
  const ptr = new Map(); let pinch = 0;
  const act = () => { lastAct = performance.now(); };
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); act(); });
  cv.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    act();
    const p = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 1) { yaw -= (e.clientX - p[0]) * 0.005; pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - p[1]) * 0.005)); }
    else { const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) dist = Math.max(4, Math.min(80, dist * (pinch / d))); pinch = d; }
  });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); act(); dist = Math.max(4, Math.min(80, dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
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
  // 움직이는 동안: 기기 성능에 맞춰 해상도를 낮춰 부드럽게 / 멈추면: 기기 최대 해상도로 선명하게(천천히 갱신)
  const maxScale = Math.min(2, window.devicePixelRatio || 1);
  function frame(now) {
    const idle = now - lastAct > 500 && !ptr.size;
    if (idle && !sharp) { sharp = true; scale = maxScale; resize(); }
    if (!idle && sharp) { sharp = false; scale = moveScale; resize(); }
    if (sharp && now - lastRender < 180) { if (!dead) raf = requestAnimationFrame(frame); return; }
    lastRender = now;
    const c = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dist);
    uni.uCam.value.copy(c);
    const m = new THREE.Matrix4().lookAt(c, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    uni.uRot.value.setFromMatrix4(m);
    uni.uTime.value = (now - t0) / 1000;
    renderer.render(scene, cam);
    if (!sharp) {
      frames++;
      if (now - fpsT > 1200) { const fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; const ns = fps < 26 ? Math.max(0.35, moveScale * 0.82) : fps > 52 ? Math.min(maxScale, moveScale * 1.12) : moveScale; if (Math.abs(ns - moveScale) > 0.04) { moveScale = ns; scale = ns; resize(); } }
    } else { fpsT = now; frames = 0; }
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
