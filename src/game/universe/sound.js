// 우주 소리 (Web Audio로 합성 — 녹음 파일이 아니라 실제 값으로 재현)
// · 펄서: 실제 자전 주기마다 '딸깍' (빠른 펄서는 그 주기의 음높이로 들림)
// · 보이저 1호: 성간 공간 플라스마 진동수(약 2~3 kHz)를 소리로
// · 블랙홀: 중력파 GW150914 '처프'(35→250 Hz)를 반복 + 낮은 울림
// · 조종석 배경음

export const PULSAR_PERIODS = { // 초
  '게 펄서': 0.0337, '돛자리 펄서': 0.0893, 'PSR B1919+21': 1.3373, '게미나': 0.2371, 'PSR J0437-4715': 0.005757,
  '헐스-테일러 펄서': 0.059, '이중 펄서 J0737-3039': 0.0227, 'PSR J1748-2446ad': 0.0013955, 'SGR 1806-20': 7.56, 'SGR 1935+2154': 3.245,
};

export function createSound() {
  let ac = null, master = null, on = false, amb = null, cur = null, curKey = '';
  function ensure() {
    if (ac) return true;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    return true;
  }
  function noiseBuffer(sec = 2) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function ambient(start) {
    if (start && !amb) {
      const g = ac.createGain(); g.gain.value = 0; g.connect(master);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(); o1.frequency.value = 55; o2.frequency.value = 55.4; o2.type = 'sawtooth';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const n = ac.createBufferSource(); n.buffer = noiseBuffer(3); n.loop = true;
      const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.6;
      const ng = ac.createGain(); ng.gain.value = 0.05;
      o1.connect(lp); o2.connect(lp); lp.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
      o1.start(); o2.start(); n.start();
      g.gain.linearRampToValueAtTime(0.06, ac.currentTime + 2);
      amb = { g, nodes: [o1, o2, n] };
    } else if (!start && amb) {
      const a = amb; amb = null;
      a.g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
      setTimeout(() => a.nodes.forEach((x) => { try { x.stop(); } catch { /* */ } }), 1000);
    }
  }
  function stopCur() {
    if (!cur) return;
    const c = cur; cur = null; curKey = '';
    c.g.gain.cancelScheduledValues(ac.currentTime);
    c.g.gain.setTargetAtTime(0, ac.currentTime, 0.08);
    clearInterval(c.timer);
    setTimeout(() => c.nodes.forEach((x) => { try { x.stop(); } catch { /* */ } }), 600);
  }
  function startCur(key, build) {
    if (!on || !ensure()) return;
    if (curKey === key) return;
    stopCur();
    const g = ac.createGain(); g.gain.value = 0; g.connect(master);
    g.gain.setTargetAtTime(0.5, ac.currentTime, 0.05);
    cur = { g, nodes: [], timer: 0 }; curKey = key;
    build(cur);
  }
  /** 펄서 신호음 */
  function pulsar(name) {
    const P = PULSAR_PERIODS[name];
    if (!P) return false;
    startCur('psr:' + name, (c) => {
      if (P < 0.02) { // 밀리초 펄서: 주기 자체가 음높이
        const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = 1 / P;
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500;
        const gg = ac.createGain(); gg.gain.value = 0.18;
        o.connect(f); f.connect(gg); gg.connect(c.g); o.start(); c.nodes.push(o);
      } else {
        const buf = noiseBuffer(0.03);
        const tick = () => {
          const s = ac.createBufferSource(); s.buffer = buf;
          const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.2;
          const e = ac.createGain(); e.gain.setValueAtTime(0.9, ac.currentTime); e.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + Math.min(0.025, P * 0.6));
          s.connect(f); f.connect(e); e.connect(c.g); s.start();
        };
        if (P < 0.05) { // 아주 빠르면 오디오 시간 기준으로 한꺼번에 예약
          const sched = () => { const t0 = ac.currentTime; for (let t = 0; t < 0.25; t += P) setTimeout(tick, t * 1000); return t0; };
          sched(); c.timer = setInterval(sched, 250);
        } else { tick(); c.timer = setInterval(tick, P * 1000); }
      }
    });
    return true;
  }
  /** 보이저 1호 성간 플라스마 (전자 플라스마 진동수 ~2.6 kHz, 밀도가 오르며 음높이 상승) */
  function plasma() {
    startCur('plasma', (c) => {
      const o = ac.createOscillator(); o.type = 'sine';
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 8;
      const n = ac.createBufferSource(); n.buffer = noiseBuffer(2); n.loop = true;
      const ng = ac.createGain(); ng.gain.value = 0.25; n.connect(f); f.connect(ng); ng.connect(c.g);
      const og = ac.createGain(); og.gain.value = 0.08; o.connect(og); og.connect(c.g);
      const sweep = () => {
        const t = ac.currentTime;
        o.frequency.setValueAtTime(2000, t); o.frequency.exponentialRampToValueAtTime(3100, t + 3.5);
        f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(3100, t + 3.5);
      };
      o.start(); n.start(); sweep(); c.timer = setInterval(sweep, 4000); c.nodes.push(o, n);
    });
  }
  /** 블랙홀: 중력파 처프 + 낮은 울림 */
  function blackhole(start) {
    if (!start) { if (curKey === 'bh') stopCur(); return; }
    startCur('bh', (c) => {
      const rum = ac.createOscillator(); rum.frequency.value = 32; const rg = ac.createGain(); rg.gain.value = 0.35; rum.connect(rg); rg.connect(c.g); rum.start(); c.nodes.push(rum);
      const chirp = () => {
        const o = ac.createOscillator(), e = ac.createGain(), t = ac.currentTime;
        o.frequency.setValueAtTime(35, t); o.frequency.exponentialRampToValueAtTime(250, t + 0.22);
        e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.7, t + 0.2); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(e); e.connect(c.g); o.start(t); o.stop(t + 0.32);
      };
      chirp(); c.timer = setInterval(chirp, 2600);
    });
  }
  return {
    get on() { return on; },
    toggle() {
      on = !on;
      if (on && ensure()) { ac.resume?.(); ambient(true); } else { if (ac) { stopCur(); ambient(false); } }
      return on;
    },
    /** 호버한 천체에 맞는 소리 (없으면 끔) */
    hover(kind, name) {
      if (!on) return;
      if (kind === 'psr' || kind === 'mag') { if (pulsar(name)) return; }
      else if (kind === 'voyager') { plasma(); return; }
      if (curKey && curKey !== 'bh') stopCur();
    },
    blackhole,
    destroy() { try { ac?.close(); } catch { /* */ } ac = null; },
  };
}
