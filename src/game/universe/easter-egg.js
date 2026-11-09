/**
 * 숨겨진 게임 트리거
 *  - 데스크톱: 코나미 코드(↑↑↓↓←→←→BA) 또는 "universe" 타이핑
 *  - 모바일: tapSelector 요소(예: 밤하늘의 달)를 1.5초 안에 N번 탭
 *
 *   const off = onSecret(() => openGame(), { tapSelector: '[data-universe-trigger]', taps: 7 });
 *   off(); // 해제
 */
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
const WORD = 'universe'.split('');

export function onSecret(callback, { tapSelector = '[data-universe-trigger]', taps = 7, windowMs = 1500 } = {}) {
  const seqs = [KONAMI, WORD];
  const progress = seqs.map(() => 0);

  const onKey = (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return; // 입력 중엔 무시
    const k = e.key.toLowerCase();
    seqs.forEach((seq, i) => {
      if (k === seq[progress[i]]) progress[i]++;
      else progress[i] = k === seq[0] ? 1 : 0;
      if (progress[i] === seq.length) { progress[i] = 0; callback(); }
    });
  };

  let count = 0, first = 0;
  const onTap = (e) => {
    if (!tapSelector || !(e.target instanceof Element) || !e.target.closest(tapSelector)) return;
    const now = Date.now();
    if (now - first > windowMs) { first = now; count = 0; }
    if (++count >= taps) { count = 0; callback(); }
  };

  window.addEventListener('keydown', onKey);
  document.addEventListener('click', onTap);
  return () => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onTap);
  };
}
