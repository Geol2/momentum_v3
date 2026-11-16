// 576×288 G2 화면 미리보기. 실제 안경 글꼴/줄 간격은 아직 모르므로 근사치입니다.
// 정확한 모양은 공식 시뮬레이터(evenhub-simulator)나 실제 안경으로 확인하세요.
import { SCREEN_H, SCREEN_W, validatePage } from './layout.js'

// SDK 밝기 0~4 → 미리보기 투명도 (0은 기기에서도 거의 안 보인다고 문서에 나옴)
const LEVEL_OPACITY = [0.12, 0.35, 0.55, 0.78, 1]
const GREEN = '#4dff7a'

export default function Preview({ page, scale = 1 }) {
  const problems = validatePage(page)
  return (
    <div>
      <div
        style={{
          position: 'relative', width: SCREEN_W * scale, height: SCREEN_H * scale,
          background: '#000', borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(77,255,122,0.25), 0 8px 30px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          {page.texts.map((t) => (
            <div
              key={t.name}
              style={{
                position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h,
                boxSizing: 'border-box', overflow: 'hidden',
                padding: t.border ? 6 : '2px 6px',
                border: t.border ? `1px solid ${GREEN}` : 'none', borderRadius: t.border ? 6 : 0,
                color: GREEN, opacity: LEVEL_OPACITY[t.level ?? 4],
                fontFamily: '"Pretendard", "Noto Sans KR", system-ui, sans-serif',
                fontSize: 20, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {t.content}
            </div>
          ))}
        </div>
      </div>
      {problems.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#ffb4a8', fontSize: 13 }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  )
}
