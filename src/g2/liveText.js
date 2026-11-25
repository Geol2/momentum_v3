// 실시간 받아 적기(Deepgram)에서 확정된 글자를 문장으로 나눕니다.
// - 온점·물음표·느낌표에서 끊고, 끝나지 않은 부분은 다음 조각과 이어 붙여요.
// - 쉬지 않고 길게 말하면 30단어에서 그냥 끊어요.
// - 바로 앞 문장과 같은 문장(다시 보내진 조각 등)은 버려요.

const END = /[^.?!]*[.?!]+["')\]]*/g
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9가-힣 ]/g, '').replace(/\s+/g, ' ').trim()

export function createSentenceSplitter(maxWords = 30) {
  let rest = '' // 아직 문장으로 안 끝난 부분
  let last = '' // 바로 앞에 내보낸 문장(중복 거르기)

  const emit = (out, s) => {
    const t = s.trim()
    if (!t || norm(t).length < 2) return
    const n = norm(t)
    if (n === norm(last) || norm(last).endsWith(n)) return
    last = t
    out.push(t)
  }

  return {
    /** 확정된 조각을 넣으면 끝난 문장들을 돌려줘요. end=true면(말이 멈춤) 남은 것도 문장으로. */
    push(text, end = false) {
      const out = []
      rest = `${rest} ${text || ''}`.replace(/\s+/g, ' ').trim()
      let used = 0
      for (const m of rest.matchAll(END)) {
        // "Mr." "e.g." 같은 짧은 조각에서 끊기지 않게 2단어 이상일 때만
        const piece = rest.slice(used, m.index + m[0].length)
        if (piece.trim().split(/\s+/).length < 2) continue
        emit(out, piece)
        used = m.index + m[0].length
      }
      rest = rest.slice(used).trim()
      const words = rest ? rest.split(/\s+/) : []
      if (end || words.length >= maxWords) { emit(out, rest); rest = '' }
      return out
    },
    /** 지금 끝나지 않은 부분(화면에 '들리는 중'으로) */
    pending: () => rest,
    /** 남은 것 전부 꺼내고 비우기 */
    flush() { const out = []; emit(out, rest); rest = ''; return out },
    reset() { rest = ''; last = '' },
  }
}
