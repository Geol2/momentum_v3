// Claude가 읽을 프로젝트 목록(useProjects)과 관리 창(ProjectManager). 폰/PC 화면 전용, 안경에는 안 보임.
//  - GitHub: 저장소 주소를 넣으면 서버가 받아 둡니다. 코드가 바뀌면 "동기화".
//  - zip 업로드: 출장 등으로 GitHub에 없는 코드를 압축해서 올립니다.
//    node_modules·build·.git 같은 폴더는 서버가 알아서 빼고 풉니다.
import { useCallback, useEffect, useState } from 'react'
import { aiProjectsApi, ApiError } from '../lib/api.js'

const POLL_MS = 3000
const MAX_ZIP_BYTES = 100 * 1024 * 1024
const BIG_ZIP_BYTES = 20 * 1024 * 1024
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

function errText(e) {
  if (e instanceof ApiError && e.message && e.message !== 'network') return e.message
  if (e instanceof ApiError && e.status === 413) return '파일이 너무 커요(최대 100MB).'
  if (e instanceof ApiError && e.status === 0) return '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 해 주세요.'
  if (e instanceof ApiError && e.status === 524) return '서버가 너무 오래 걸렸어요. node_modules·build를 빼고 더 작게 압축해 주세요.'
  return '요청에 실패했어요.'
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS = { ready: '준비됨', syncing: '받는 중...', error: '실패' }

// 프로젝트 목록. 사이드바와 관리 창이 같은 목록을 보도록 한 곳에서 불러옵니다.
export function useProjects() {
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setProjects(await aiProjectsApi.list())
      setError('')
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => { load() }, [load])
  // 받는 중인 프로젝트가 있으면 끝날 때까지 상태를 새로 봅니다.
  const syncing = projects?.some((p) => p.status === 'syncing')
  useEffect(() => {
    if (!syncing) return undefined
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [syncing, load])
  return { projects, load, error }
}

// 프로젝트 관리: 목록(동기화·삭제), GitHub 추가, zip 업로드. onSelect(name): 올린 프로젝트를 바로 고름
export default function ProjectManager({ projects, load, onSelect }) {
  const [error, setError] = useState('')
  // busy: 추가·동기화·삭제 같은 짧은 작업. upload: zip 업로드(길 수 있어 따로 둡니다 —
  // 업로드 중에도 GitHub 추가 등은 할 수 있게).
  const [busy, setBusy] = useState('')
  const [upload, setUpload] = useState(null) // { pct } 또는 null
  // 파일 선택 칸을 비울 때 쓰는 key (input type=file은 값으로 비울 수 없음)
  const [fileKey, setFileKey] = useState(0)
  const [gitUrl, setGitUrl] = useState('')
  const [zipName, setZipName] = useState('')
  const [zipFile, setZipFile] = useState(null)

  // 비공개 저장소 가능 여부(서버 토큰). 예전 서버면 실패 → 공개만으로 안내
  const [privateRepos, setPrivateRepos] = useState(false)
  useEffect(() => {
    aiProjectsApi.settings().then((s) => setPrivateRepos(!!s?.privateRepos)).catch(() => {})
  }, [])

  const run = async (label, fn) => {
    setError('')
    setBusy(label)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  const addGit = (e) => {
    e.preventDefault()
    if (!gitUrl.trim()) return
    run('git', async () => {
      await aiProjectsApi.addGit(gitUrl.trim())
      setGitUrl('')
    })
  }

  const uploadZip = async (e) => {
    e.preventDefault()
    if (!zipFile || !zipName.trim() || upload) return
    if (zipFile.size > MAX_ZIP_BYTES) {
      setError(`zip이 ${mb(zipFile.size)}예요. 100MB까지 올릴 수 있어요. node_modules·build·.git을 빼고 다시 압축해 주세요.`)
      return
    }
    setError('')
    setUpload({ pct: 0 })
    try {
      const p = await aiProjectsApi.upload(zipName.trim(), zipFile, (ratio) => setUpload({ pct: Math.round(ratio * 100) }))
      setZipFile(null)
      setZipName('')
      setFileKey((k) => k + 1)
      await load()
      onSelect(p.name)
    } catch (err) {
      setError(errText(err))
    } finally {
      setUpload(null)
    }
  }

  const pickZip = (file) => {
    setZipFile(file || null)
    if (file && file.size > BIG_ZIP_BYTES) {
      setError(`zip이 ${mb(file.size)}로 커서 올리는 데 몇 분 걸릴 수 있어요. node_modules·build·.git을 빼고 압축하면 훨씬 빨라요.`)
    } else {
      setError('')
    }
    // 이름을 안 적었으면 파일 이름에서 가져옵니다(영문·숫자·.-_ 만).
    if (file && !zipName) setZipName(file.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40))
  }

  return (
    <div>
      {error && <p style={{ ...hint, color: '#ffb4a8' }}>{error}</p>}
      {(
        <div style={{ marginTop: 4 }}>
          {projects === null && <p style={hint}>불러오는 중...</p>}
          {projects?.length === 0 && <p style={hint}>아직 프로젝트가 없어요. 아래에서 추가하세요.</p>}
          {projects?.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {projects.map((p) => (
                <li key={p.name} style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>
                      {p.name} <span style={tag}>{p.source === 'git' ? 'GitHub' : 'zip'}</span>
                      <span style={{ ...tag, color: p.status === 'error' ? '#ffb4a8' : p.status === 'ready' ? '#4dff7a' : '#9aa0aa' }}>{STATUS[p.status]}</span>
                    </div>
                    <div style={{ ...hint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {when(p.updatedAt)} · {p.message}
                    </div>
                  </div>
                  {p.source === 'git' && (
                    <button type="button" style={btn} disabled={!!busy || p.status === 'syncing'}
                      onClick={() => run(`sync:${p.name}`, () => aiProjectsApi.sync(p.name))}>동기화</button>
                  )}
                  <button type="button" style={btn} disabled={!!busy || p.status === 'syncing'}
                    onClick={() => { if (window.confirm(`${p.name} 프로젝트를 서버에서 지울까요?`)) run(`del:${p.name}`, () => aiProjectsApi.remove(p.name)) }}>
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addGit} style={{ marginTop: 12 }}>
            <label htmlFor="g2-git" style={sub}>
              GitHub 저장소 추가 {privateRepos ? '(공개·비공개)' : '(공개 저장소 · 비공개는 서버에 GitHub 토큰 설정 필요)'}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="g2-git" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)}
                placeholder="github.com/소유자/저장소" style={input} />
              <button type="submit" style={btn} disabled={!!busy || !gitUrl.trim()}>{busy === 'git' ? '추가 중...' : '추가'}</button>
            </div>
          </form>

          <form onSubmit={uploadZip} style={{ marginTop: 12 }}>
            <label htmlFor="g2-zip" style={sub}>zip 업로드 (출장 등 GitHub에 없는 코드, 최대 100MB)</label>
            <input key={fileKey} id="g2-zip" type="file" accept=".zip,application/zip" onChange={(e) => pickZip(e.target.files?.[0])}
              style={{ fontSize: 13, color: '#9aa0aa', marginBottom: 6, maxWidth: '100%' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder="프로젝트 이름 (영문)"
                aria-label="업로드할 프로젝트 이름" style={input} />
              <button type="submit" style={btn} disabled={!!upload || !zipFile || !zipName.trim()}>
                {!upload ? '업로드' : upload.pct < 100 ? `올리는 중 ${upload.pct}%` : '서버에서 푸는 중...'}
              </button>
            </div>
            {zipFile && !upload && <p style={hint}>{zipFile.name} · {mb(zipFile.size)}</p>}
            {upload && (
              <div style={{ height: 6, background: '#1a1e26', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}
                role="progressbar" aria-valuenow={upload.pct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${upload.pct}%`, height: '100%', background: '#4dff7a', transition: 'width .3s' }} />
              </div>
            )}
            <p style={hint}>같은 이름으로 다시 올리면 새 코드로 바뀌어요. node_modules·build·.git은 빼고 압축하면 빨라요.</p>
          </form>
        </div>
      )}
    </div>
  )
}

const hint = { fontSize: 12, color: '#6b717c', margin: '6px 0 0' }
const sub = { display: 'block', fontSize: 13, color: '#c8ccd4', marginBottom: 6 }
const tag = { fontSize: 11, color: '#9aa0aa', border: '1px solid #2a2f3a', borderRadius: 4, padding: '0 4px', marginLeft: 6 }
const row = { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1e26' }
const input = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', background: '#12151c', color: '#e8e8ea',
  border: '1px solid #2a2f3a', borderRadius: 8, padding: '8px 10px', fontSize: 14,
}
const btn = {
  background: 'rgba(77,255,122,0.08)', color: '#c8ffd6', whiteSpace: 'nowrap',
  border: '1px solid rgba(77,255,122,0.35)', borderRadius: 8,
  padding: '8px 12px', fontSize: 14, cursor: 'pointer',
}
