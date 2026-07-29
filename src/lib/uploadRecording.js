import { apiFetch, ApiError } from './api.js'

// Cloudflare 무료 플랜의 업로드 상한. 서버까지 갔다가 413으로 돌아오면 1시간짜리를
// 통째로 올려보고 나서야 실패를 알게 되므로 먼저 걸러냅니다.
const MAX_BYTES = 100 * 1024 * 1024

/**
 * 녹음을 우리 백엔드로 올립니다. 백엔드가 세션을 검증한 뒤 n8n으로 전달합니다.
 *
 * 예전에는 브라우저가 공유 키를 들고 n8n 웹훅을 직접 호출했습니다. VITE_* 값은
 * 빌드 시점에 번들로 인라인되므로 그 키는 방문자 누구나 읽을 수 있었고, 애초에
 * "누가 올렸는지"를 구분할 수 없어 인증 구실을 못 했습니다. 지금은 로그인한
 * 사용자의 JWT로 인증하고(apiFetch가 붙여줍니다), 웹훅 주소와 키는 서버에만 있습니다.
 */
export async function uploadRecording(blob, { title, filename } = {}) {
  // iOS가 만든 헤더만 있는 빈 webm(5~25바이트)을 걸러냅니다. 1초짜리 정상 녹음도
  // mp4/aac 32kbps면 수 KB이므로, 1KB 미만은 사실상 빈/깨진 파일입니다.
  if (!blob || blob.size < 1024) throw new Error('녹음이 비어 있거나 너무 짧아요. 다시 녹음해 주세요.')
  if (blob.size > MAX_BYTES) {
    throw new Error(`파일이 너무 커요 (${(blob.size / 1024 / 1024).toFixed(0)}MB · 최대 100MB). 나눠서 녹음해 주세요.`)
  }

  const fd = new FormData()
  fd.append('file', blob, filename || 'recording.webm')
  fd.append('title', title || '무제')

  try {
    return await apiFetch('/api/recordings', { method: 'POST', body: fd })
  } catch (e) {
    if (e instanceof ApiError) throw new Error(messageFor(e))
    throw e
  }
}

function messageFor(e) {
  switch (e.status) {
    // apiFetch가 status 0으로 표시하는 네트워크 계층 실패 — 연결 없음, DNS, TLS,
    // 또는 인앱 브라우저의 차단입니다.
    case 0: return '서버에 연결하지 못했어요. 네트워크 상태를 확인해 주세요.'
    // apiFetch가 이미 세션을 정리하고 로그인 화면으로 되돌립니다.
    case 401: return '세션이 만료됐어요. 다시 로그인한 뒤 저장해 주세요.'
    case 413: return '파일이 너무 커서 서버가 거부했어요 (100MB 제한).'
    // 우리 서버는 살아 있는데 n8n 쪽이 죽었거나 응답하지 않는 경우.
    case 502:
    case 504: return '저장 서버(n8n)가 응답하지 않아요. 잠시 후 다시 시도해 주세요.'
    case 503: return '녹음 저장 기능이 아직 설정되지 않았어요.'
    default: return e.message || `업로드 실패 (${e.status})`
  }
}
