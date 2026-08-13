import * as pdfjs from 'pdfjs-dist'
// Vite가 워커를 별도 에셋으로 뽑아 주소만 넘겨줍니다. 번들에 인라인하면 메인 청크가
// 1MB 넘게 불어나고, pdf.js는 어차피 워커를 별도 파일로만 띄울 수 있습니다.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pageToParagraphs } from './pdfLayout.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * PDF에서 "읽는 순서대로" 텍스트를 뽑습니다. 좌표를 문단으로 되돌리는 규칙은
 * pdfLayout.js에 있습니다(브라우저 없이도 검증할 수 있게 떼어 뒀습니다).
 */

/**
 * @returns {Promise<{paragraphs: {page:number,text:string}[], pageCount:number, charCount:number, likelyScanned:boolean}>}
 */
export async function extractPdfText(file, { onProgress, pageFrom = 1, pageTo = 0 } = {}) {
  const data = await file.arrayBuffer()
  // isEvalSupported:false — 우리 페이지의 CSP를 건드리지 않으려는 것. 글꼴 힌팅용
  // eval이 막혀도 텍스트 추출에는 영향이 없습니다.
  // 뒷정리(destroy)는 문서가 아니라 로딩 태스크에 달려 있습니다(pdf.js 6). 문서에서
  // 부르면 TypeError라 결과까지 함께 날아갑니다.
  const task = pdfjs.getDocument({ data, isEvalSupported: false })
  const doc = await task.promise

  try {
    const from = Math.max(1, pageFrom)
    const to = pageTo > 0 ? Math.min(pageTo, doc.numPages) : doc.numPages
    const paragraphs = []
    let charCount = 0

    for (let n = from; n <= to; n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items.filter((it) => it.str && it.str.trim())

      for (const text of pageToParagraphs(items, viewport)) {
        paragraphs.push({ page: n, text })
        charCount += text.length
      }

      page.cleanup()
      onProgress?.({ page: n - from + 1, total: to - from + 1 })
    }

    return {
      paragraphs,
      pageCount: doc.numPages,
      charCount,
      // 텍스트 레이어가 없는 스캔본이면 여기서 거의 아무것도 안 나옵니다 → OCR 안내.
      likelyScanned: charCount < (to - from + 1) * 120,
    }
  } finally {
    await task.destroy()
  }
}

/**
 * 스캔본 PDF를 페이지 이미지로 그린 뒤 Tesseract로 읽습니다. 브라우저 안에서만 돌고
 * 파일은 서버로 나가지 않습니다 — 대신 페이지당 수십 초로 매우 느립니다.
 */
export async function ocrPdfPages(file, { langs = 'eng', onProgress, pageFrom = 1, pageTo = 0 } = {}) {
  const data = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data, isEvalSupported: false })
  const doc = await task.promise
  const Tesseract = (await import('tesseract.js')).default
  let worker

  try {
    worker = await Tesseract.createWorker(langs, 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
      cachePath: 'tess-best',
    })

    const from = Math.max(1, pageFrom)
    const to = pageTo > 0 ? Math.min(pageTo, doc.numPages) : doc.numPages
    const paragraphs = []
    let charCount = 0

    for (let n = from; n <= to; n++) {
      const page = await doc.getPage(n)
      // 스캔본은 대개 150dpi 안팎이라 2배로 키워야 OCR이 글자를 잡습니다.
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise

      const { data: res } = await worker.recognize(canvas)
      // OCR 결과는 빈 줄로 문단이 나뉩니다.
      for (const block of (res.text || '').split(/\n\s*\n/)) {
        const text = block.replace(/\s*\n\s*/g, ' ').trim()
        if (text.length < 2) continue
        paragraphs.push({ page: n, text })
        charCount += text.length
      }

      canvas.width = 0
      canvas.height = 0
      page.cleanup()
      onProgress?.({ page: n - from + 1, total: to - from + 1 })
    }

    return { paragraphs, pageCount: doc.numPages, charCount, likelyScanned: false }
  } finally {
    await worker?.terminate()
    await task.destroy()
  }
}
