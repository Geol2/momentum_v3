const WEBHOOK = import.meta.env.VITE_RECORDING_WEBHOOK || ''
const KEY = import.meta.env.VITE_RECORDING_KEY || ''

// 웹훅 주소가 없으면(로컬 dev 등) 업로드 UI 자체를 감춥니다 — 눌러봐야 실패할
// 버튼을 보여주는 것보다 없는 편이 낫습니다.
export const uploadConfigured = !!WEBHOOK

// Cloudflare 무료 플랜의 업로드 상한. 서버까지 갔다가 413으로 돌아오면
// 1시간짜리를 통째로 올려보고 나서야 실패를 알게 되므로 먼저 걸러냅니다.
const MAX_BYTES = 100 * 1024 * 1024

/**
 * 녹음 blob을 n8n 웹훅으로 올립니다.
 *
 * 인증 키를 커스텀 헤더가 아니라 폼 필드로 보냅니다. 헤더를 쓰면 CORS 프리플라이트가
 * 강제되고 n8n이 Access-Control-Allow-Headers를 실어주는지에 매번 의존하게 되는데,
 * 이 키는 어차피 번들에 인라인되어 공개되므로 헤더에 숨겨봐야 얻는 게 없습니다.
 */
export async function uploadRecording(blob, { title, filename } = {}) {
  if (!WEBHOOK) throw new Error('업로드 주소가 설정되지 않았어요.')
  if (!blob || blob.size === 0) throw new Error('업로드할 녹음이 없어요.')
  if (blob.size > MAX_BYTES) {
    throw new Error(`파일이 너무 커요 (${(blob.size / 1024 / 1024).toFixed(0)}MB · 최대 100MB). 나눠서 녹음해 주세요.`)
  }

  const fd = new FormData()
  // Content-Type을 직접 지정하면 안 됩니다. FormData를 그대로 넘겨야 브라우저가
  // boundary가 포함된 multipart/form-data를 붙여줍니다. 손으로 쓰면 boundary가
  // 빠져서 n8n이 본문을 바이너리로 파싱하지 못합니다.
  fd.append('audio', blob, filename || 'recording.webm')
  fd.append('title', title || '무제')
  if (KEY) fd.append('key', KEY)

  let res
  try {
    res = await fetch(WEBHOOK, { method: 'POST', body: fd })
  } catch {
    // fetch가 거부되는 건 네트워크 단절이거나 CORS 차단입니다. HTTP 상태가 없어서
    // 둘을 구분할 수 없으니, 실제로 더 흔한 쪽(CORS)을 같이 안내합니다.
    throw new Error('서버에 연결하지 못했어요. 네트워크 또는 n8n의 Allowed Origins 설정을 확인해 주세요.')
  }

  if (!res.ok) {
    if (res.status === 413) throw new Error('파일이 너무 커서 서버가 거부했어요 (100MB 제한).')
    if (res.status === 401 || res.status === 403) throw new Error('업로드 키가 거부됐어요.')
    if (res.status === 404) throw new Error('웹훅 주소를 찾을 수 없어요. n8n 워크플로가 활성 상태인지 확인해 주세요.')
    throw new Error(`업로드 실패 (${res.status})`)
  }

  // n8n의 Respond 노드 설정에 따라 응답이 JSON이 아닐 수 있습니다. 본문은 부가
  // 정보일 뿐이라, 파싱에 실패해도 업로드가 성공한 사실은 그대로입니다.
  try {
    return await res.json()
  } catch {
    return null
  }
}
