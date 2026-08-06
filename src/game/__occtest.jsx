// 임시 확인용 하네스 — 검증 후 삭제.
import { createRoot } from 'react-dom/client'
import Game3D from './Game3D.jsx'
import { maskUniforms } from './occlusionMask.jsx'

// 콘솔에서 occ(0) / occ(1) 로 켜고 끄며 A/B 비교.
window.occ = (v) => { maskUniforms.uAmount.value = v; return v }

createRoot(document.getElementById('root')).render(<Game3D onExit={() => {}} />)
