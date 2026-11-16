import React from 'react'
import ReactDOM from 'react-dom/client'
import G2App from './G2App.jsx'
// 로그인 화면(Login.jsx)이 전역 스타일을 쓰므로 함께 불러옵니다.
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <G2App />
  </React.StrictMode>,
)
