// Claude가 읽을 프로젝트 고르기·관리 (폰/PC 화면 전용, 안경에는 안 보임)
//  - GitHub: 저장소 주소를 넣으면 서버가 받아 둡니다. 코드가 바뀌면 "동기화".
//  - zip 업로드: 출장 등으로 GitHub에 없는 코드를 압축해서 올립니다.
//    node_modules·build·.git 같은 폴더는 서버가 알아서 빼고 풉니다.
import { useCallback, useEffect, useState } from 'react'
import { aiProjectsApi, ApiError } from '../lib/api.js'

const POLL_MS = 3000

function errText(e) {
  if (e instanceof ApiError && e.message && e.message !== 'network') return e.message
  if (e instanceof ApiError && e.status === 413) return '파일이 너무 커요(최대 100MB).'
  return '요청에 실패했어요.'
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS = { ready: '준비됨', syncing: '받는 중...', error: '실패' }

export default function ProjectsPanel({ selected, onSelect, disabled }) {
  const [projects, setProjects] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [zipName, setZipName] = useState('')
  const [zipFile, setZipFile] = useState(null)

  const load = useCallback(async () => {
    try {
      setProjects(await aiProjectsApi.list())
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

  // 고른 프로젝트가 지워졌으면 선택을 풉니다. 업로드 직후처럼 목록을 새로 받는 중에는 건너뜁니다.
  useEffect(() => {
    if (!busy && projects && selected && !projects.some((p) => p.name === selected)) onSelect('')
  }, [busy, projects, selected, onSelect])

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

  const upload = (e) => {
    e.preventDefault()
    if (!zipFile || !zipName.trim()) return
    run('upload', async () => {
      const p = await aiProjectsApi.upload(zipName.trim(), zipFile)
      setZipFile(null)
      setZipName('')
      onSelect(p.name)
    })
  }

  const pickZip = (file) => {
    setZipFile(file || null)
    // 이름을 안 적었으면 파일 이름에서 가져옵니다(영문·숫자·.-_ 만).
    if (file && !zipName) setZipName(file.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40))
  }

  const ready = (projects || []).filter((p) => p.status === 'ready')

  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="g2-project" style={{ fontSize: 14, fontWeight: 600 }}>프로젝트</label>
        <select
          id="g2-project"
          value={selected}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
          style={{ ...input, flex: '1 1 160px', width: 'auto' }}
        >
          <option value="">없음 (일반 질문)</option>
          {ready.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <button type="button" onClick={() => setOpen((o) => !o)} style={btn} aria-expanded={open}>
          {open ? '관리 닫기' : '관리'}
        </button>
      </div>
      <p style={hint}>
        {selected
          ? `Claude가 ${selected} 코드를 직접 찾아 읽고 답해요. 1~3분 걸릴 수 있어요.`
          : '프로젝트를 고르면 Claude가 그 코드를 직접 읽으며 답해요.'}
      </p>

      {error && <p style={{ ...hint, color: '#ffb4a8' }}>{error}</p>}

      {open && (
        <div style={{ marginTop: 10 }}>
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
            <label htmlFor="g2-git" style={sub}>GitHub 저장소 추가 (공개 저장소)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="g2-git" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)}
                placeholder="github.com/소유자/저장소" style={input} />
              <button type="submit" style={btn} disabled={!!busy || !gitUrl.trim()}>{busy === 'git' ? '추가 중...' : '추가'}</button>
            </div>
          </form>

          <form onSubmit={upload} style={{ marginTop: 12 }}>
            <label htmlFor="g2-zip" style={sub}>zip 업로드 (출장 등 GitHub에 없는 코드, 최대 100MB)</label>
            <input id="g2-zip" type="file" accept=".zip,application/zip" onChange={(e) => pickZip(e.target.files?.[0])}
              style={{ fontSize: 13, color: '#9aa0aa', marginBottom: 6, maxWidth: '100%' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder="프로젝트 이름 (영문)"
                aria-label="업로드할 프로젝트 이름" style={input} />
              <button type="submit" style={btn} disabled={!!busy || !zipFile || !zipName.trim()}>
                {busy === 'upload' ? '올리는 중...' : '업로드'}
              </button>
            </div>
            <p style={hint}>같은 이름으로 다시 올리면 새 코드로 바뀌어요. node_modules·build·.git은 빼고 풀어요.</p>
          </form>
        </div>
      )}
    </div>
  )
}

const box = { marginBottom: 4 }
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
