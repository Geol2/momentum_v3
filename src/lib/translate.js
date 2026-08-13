import { apiFetch } from './api.js'

/**
 * 번역 엔진 두 갈래를 같은 모양으로 감쌉니다.
 *
 *  1) 브라우저 내장 번역기(Chrome 138+ 데스크톱, Translator API)
 *     — 키도 비용도 없고 기기 안에서 돕니다. 대신 문장 단위 번역기라 논문 문체·전문용어는
 *       무너집니다. 초록 훑어보기용으로 보세요.
 *  2) 서버 번역(백엔드 → n8n → LLM)
 *     — 논문 품질은 사실상 이쪽만 됩니다. 키는 서버에만 두고 프론트는 경로만 압니다.
 *       VITE_TRANSLATE_SERVER=1 일 때만 켜집니다(백엔드에 /api/translate 가 있어야 함).
 *
 * 서버 경로가 켜져 있으면 그쪽을 먼저 씁니다.
 */

export const SERVER_ENABLED = import.meta.env.VITE_TRANSLATE_SERVER === '1'

// 서버 한 번에 보낼 양. Cloudflare Tunnel이 ~100초에서 끊기므로 논문 한 편을 한 요청에
// 밀어 넣으면 반드시 타임아웃입니다. 문단 몇 개씩 나눠 보냅니다.
const SERVER_CHUNK_CHARS = 3500

export const SOURCE_LANGS = [
  { code: 'auto', label: '자동 감지' },
  { code: 'en', label: '영어' },
  { code: 'ja', label: '일본어' },
  { code: 'zh', label: '중국어' },
  { code: 'de', label: '독일어' },
  { code: 'fr', label: '프랑스어' },
  { code: 'es', label: '스페인어' },
  { code: 'ru', label: '러시아어' },
]

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function localAvailability(source, target) {
  if (typeof self === 'undefined' || !('Translator' in self)) return 'unsupported'
  try {
    return await self.Translator.availability({ sourceLanguage: source, targetLanguage: target })
  } catch {
    // 지원하지 않는 언어쌍을 물으면 예외를 던집니다.
    return 'unavailable'
  }
}

/** 원문 언어 자동 감지. 브라우저에 감지기가 없으면 null(호출한 쪽이 영어로 가정). */
export async function detectLanguage(text) {
  if (typeof self === 'undefined' || !('LanguageDetector' in self)) return null
  let detector
  try {
    detector = await self.LanguageDetector.create()
    const results = await detector.detect(text.slice(0, 2000))
    return results?.[0]?.detectedLanguage || null
  } catch {
    return null
  } finally {
    detector?.destroy?.()
  }
}

function chunkByChars(texts, limit) {
  const chunks = []
  let cur = []
  let size = 0
  for (const t of texts) {
    // 문단 하나가 한도를 넘으면 혼자 한 덩어리로 갑니다(쪼개면 문맥이 끊깁니다).
    if (cur.length && size + t.length > limit) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(t)
    size += t.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

function serverEngine({ source, target }) {
  return {
    kind: 'server',
    async translateAll(texts, onProgress) {
      const out = []
      const chunks = chunkByChars(texts, SERVER_CHUNK_CHARS)
      for (const chunk of chunks) {
        const res = await apiFetch('/api/translate', {
          method: 'POST',
          body: JSON.stringify({ texts: chunk, source, target }),
        })
        const lines = res?.translations
        // 서버가 문단 수를 안 맞춰 주면 어디가 어긋났는지 알 수 없습니다. 조용히
        // 밀린 채로 보여 주느니 실패로 알립니다.
        if (!Array.isArray(lines) || lines.length !== chunk.length) {
          throw new Error('서버 번역 응답이 문단 수와 맞지 않습니다')
        }
        out.push(...lines)
        onProgress?.(out.length, texts.length)
      }
      return out
    },
    destroy() {},
  }
}

async function chromeEngine({ source, target, onDownload }) {
  const translator = await self.Translator.create({
    sourceLanguage: source,
    targetLanguage: target,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onDownload?.(e.loaded))
    },
  })
  return {
    kind: 'chrome',
    async translateAll(texts, onProgress) {
      const out = []
      // 내장 번역기는 한 번에 하나씩만 받습니다. 문단 단위로 돌려 진행률을 보여 줍니다.
      for (const text of texts) {
        out.push(await translator.translate(text))
        onProgress?.(out.length, texts.length)
      }
      return out
    },
    destroy() {
      translator.destroy?.()
    },
  }
}

/**
 * 사용자 제스처(버튼 클릭) 안에서 곧바로 불러야 합니다 — Translator.create()는 사용자
 * 활성화가 없으면 거부됩니다. 앞에 await가 끼면 활성화가 만료될 수 있습니다.
 */
export async function createEngine({ source, target, onDownload }) {
  if (SERVER_ENABLED) return serverEngine({ source, target })
  if (typeof self === 'undefined' || !('Translator' in self)) {
    throw new Error('no-engine')
  }
  return chromeEngine({ source, target, onDownload })
}
