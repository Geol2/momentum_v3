/**
 * pdf.js가 준 글자 조각들을 "사람이 읽는 순서의 문단"으로 되돌리는 순수 로직.
 *
 * pdf.js에 의존하지 않게 떼어 둔 이유는 두 가지입니다: 브라우저 밖(Node)에서도 실제
 * 논문으로 결과를 확인할 수 있고, 조판 판정 규칙을 이 파일 하나만 보면 되기 때문입니다.
 *
 * 입력 조각은 {str, width, height, transform:[a,b,c,d,x,y]} 모양(pdf.js TextItem)이면 됩니다.
 * 한계(고칠 수 없는 것): 수식·표·그림 캡션은 조각 순서가 원래 뒤엉켜 있어 깨집니다.
 * 회전된 페이지(세로쓰기·가로 스캔)도 지원하지 않습니다.
 */

// 페이지 위·아래 이 비율 안쪽에 있는 짧은 줄은 머리말/쪽번호로 보고 버립니다.
const MARGIN_BAND = 0.05

const itemX = (it) => it.transform[4]
const itemY = (it) => it.transform[5]
const itemH = (it) => Math.abs(it.transform[3]) || it.height || 10
const itemW = (it) => it.width || 0

/**
 * 가로쓰기 조각만 남깁니다. arXiv 도장처럼 여백에 90도로 세워 둔 글자는 y가 본문과
 * 겹쳐서, 그냥 두면 본문 한복판에 "arXiv:1512.03385v1 [cs.CV]"가 끼어듭니다.
 * 가로쓰기면 변환행렬의 가로 성분(a)이 세로 성분(b)보다 큽니다.
 */
export const isHorizontal = (it) => Math.abs(it.transform[0]) > Math.abs(it.transform[1])

/** 정렬된 배열의 백분위 값. */
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

/** 조각들을 y좌표로 묶어 한 줄씩 만듭니다. */
export function toLines(items) {
  // PDF 좌표는 아래가 0이라, 위에서 아래로 읽으려면 y 내림차순입니다.
  const sorted = [...items].sort((a, b) => (itemY(b) - itemY(a)) || (itemX(a) - itemX(b)))

  const lines = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    // 같은 줄이라도 위첨자·글꼴이 섞이면 y가 미세하게 다릅니다. 글자 높이의 절반까지는
    // 한 줄로 봅니다.
    if (last && Math.abs(last.y - itemY(it)) <= Math.max(1.5, itemH(it) * 0.5)) last.parts.push(it)
    else lines.push({ y: itemY(it), parts: [it] })
  }

  return lines.map((line) => {
    const parts = line.parts.sort((a, b) => itemX(a) - itemX(b))
    let text = ''
    let prevEnd = null
    for (const p of parts) {
      // 조각 사이가 벌어져 있으면 원래 띄어쓰기입니다. pdf.js가 공백을 조각으로 주는
      // 경우도 있어 이미 공백이면 덧붙이지 않습니다.
      if (prevEnd != null && itemX(p) - prevEnd > itemH(p) * 0.2 && !text.endsWith(' ') && !p.str.startsWith(' ')) {
        text += ' '
      }
      text += p.str
      prevEnd = itemX(p) + itemW(p)
    }
    return { text: text.replace(/\s+/g, ' ').trim(), y: line.y, x0: itemX(parts[0]), x1: prevEnd }
  }).filter((l) => l.text)
}

/**
 * 2단 조판이면 좌·우로 갈라 왼쪽 단을 먼저 읽게 합니다. 가운데를 가로지르는 조각
 * (제목처럼 단 위에 걸친 것)은 따로 모아 맨 앞에 둡니다 — 왼쪽/오른쪽 어느 한쪽에
 * 밀어 넣으면 제목이 본문 문단 사이에 끼어듭니다.
 */
export function splitColumns(items, width) {
  const mid = width / 2
  const band = width * 0.04
  const spanning = []
  const left = []
  const right = []

  for (const it of items) {
    if (itemX(it) < mid - band && itemX(it) + itemW(it) > mid + band) spanning.push(it)
    else if (itemX(it) + itemW(it) / 2 < mid) left.push(it)
    else right.push(it)
  }

  const total = items.length || 1
  const twoCol =
    spanning.length / total < 0.06 && left.length / total > 0.25 && right.length / total > 0.25
  if (!twoCol) return [items]
  return spanning.length ? [spanning, left, right] : [left, right]
}

/**
 * 좌우 폭이 다른 덩어리(초록, 인용문, 캡션)를 갈라냅니다.
 *
 * 초록은 본문보다 좌우를 좁혀 조판하는 일이 흔한데, 페이지 하나의 폭으로 재면 초록의
 * 모든 줄이 "들여쓰기됐고 폭도 못 채웠다" = 줄마다 새 문단으로 오인됩니다.
 *
 * 나누는 조건은 왼쪽과 오른쪽 끝이 **둘 다** 움직였을 때뿐입니다. 한쪽만 움직인 건
 * 문단 첫 줄의 들여쓰기(왼쪽만)나 문단 마지막 줄(오른쪽만)이라, 여기서 자르면
 * 멀쩡한 문단이 토막 납니다.
 */
export function splitBlocks(lines, tol) {
  const blocks = []
  let cur = null
  for (const line of lines) {
    if (!cur) {
      cur = [line]
      blocks.push(cur)
      continue
    }
    const bx0 = percentile(cur.map((l) => l.x0).sort((a, b) => a - b), 0.2)
    const bx1 = percentile(cur.map((l) => l.x1).sort((a, b) => a - b), 0.8)
    if (Math.abs(line.x0 - bx0) > tol && Math.abs(line.x1 - bx1) > tol) {
      cur = [line]
      blocks.push(cur)
    } else {
      cur.push(line)
    }
  }
  return blocks
}

/**
 * 줄을 문단으로 잇습니다. 판단 근거는 두 가지뿐입니다:
 *  - 앞 줄이 단 폭을 다 못 채우고 끝났다 → 문단(또는 제목)이 거기서 끝난 것
 *  - 다음 줄이 들여쓰기로 시작한다 → 새 문단
 * 마침표 유무로 나누면 "Fig. 1" 같은 약어마다 문단이 끊겨 오히려 나빠집니다.
 */
export function toParagraphs(lines) {
  if (!lines.length) return []
  // 단의 왼쪽 끝은 가장 왼쪽 줄이 아니라 하위 20% 지점으로 잡습니다. 각주 기호나
  // 목록 번호 한 줄 때문에 기준선이 밀리는 걸 막습니다.
  // 오른쪽 끝을 max로 잡으면 제목이나 표 한 줄이 기준 폭을 부풀려서, 정작 본문은
  // 전부 "폭을 못 채운 줄" = 문단 끝으로 판정됩니다(=한 줄이 한 문단이 됨). 양끝맞춤된
  // 본문은 같은 x에서 끝나므로 80% 지점이 실제 단 오른쪽 끝에 가깝습니다.
  const colX0 = percentile(lines.map((l) => l.x0).sort((a, b) => a - b), 0.2)
  const colX1 = percentile(lines.map((l) => l.x1).sort((a, b) => a - b), 0.8)
  const width = Math.max(1, colX1 - colX0)

  const out = []
  let cur = ''
  let prevShort = false

  for (const line of lines) {
    const indented = line.x0 - colX0 > Math.max(6, width * 0.035)
    if (cur && (prevShort || indented)) {
      out.push(cur)
      cur = ''
    }
    if (!cur) {
      cur = line.text
    } else if (/[A-Za-z]-$/.test(cur) && /^[a-z]/.test(line.text)) {
      // 줄 끝에서 잘린 단어(inter-\nnational)는 하이픈을 지우고 붙입니다.
      // 대신 원래 하이픈이 있던 합성어가 하필 그 하이픈에서 줄바꿈되면 하이픈이
      // 사라집니다(high-level → highlevel). PDF만 봐서는 둘을 구분할 수 없고,
      // 번역기는 "highlevel"은 알아들어도 "learn- ing"은 못 알아들어서 이쪽을
      // 택했습니다.
      cur = cur.slice(0, -1) + line.text
    } else {
      cur += ' ' + line.text
    }
    prevShort = line.x1 - colX0 < width * 0.86
  }
  if (cur) out.push(cur)
  return out
}

export function isRunningHead(line, pageHeight) {
  const inBand = line.y > pageHeight * (1 - MARGIN_BAND) || line.y < pageHeight * MARGIN_BAND
  if (!inBand) return false
  // 쪽번호, 저널명 같은 짧은 줄만 버립니다. 여백에 본문이 걸친 경우까지 지우면
  // 문장이 소리 없이 사라집니다.
  return /^[ivxlcdm\d\s.\-—]+$/i.test(line.text) || line.text.length < 55
}

/** 한 페이지의 조각 → 문단 문자열 배열. */
export function pageToParagraphs(items, viewport) {
  const out = []
  for (const column of splitColumns(items.filter(isHorizontal), viewport.width)) {
    const lines = toLines(column).filter((l) => !isRunningHead(l, viewport.height))
    for (const block of splitBlocks(lines, viewport.width * 0.025)) {
      out.push(...toParagraphs(block))
    }
  }
  return out
}
