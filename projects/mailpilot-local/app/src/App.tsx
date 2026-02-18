import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import './App.css'

type Task = {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

type GmailMessageListItem = {
  id: string
  threadId: string
}

type GmailMessage = {
  id: string
  threadId: string
  snippet: string
  payload?: {
    headers?: { name: string; value: string }[]
  }
}

type MailItem = {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
}

type RankedMail = MailItem & {
  score: number
  reasons: string[]
}

type DraftTone = 'professional' | 'friendly'

type StoredMail = MailItem

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const REDIRECT_URI = 'http://127.0.0.1:8765/callback'
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || ''

const KEYCHAIN_TOKEN_KEY = 'gmail_token'
const KEYCHAIN_PKCE_KEY = 'gmail_pkce_verifier'

const tasks: Task[] = [
  { id: 'auth', title: 'Gmail OAuth login + Keychain token', status: 'done' },
  { id: 'sync', title: 'Fetch last 7 days emails', status: 'done' },
  { id: 'rank', title: 'Top 5 priority scoring', status: 'done' },
  { id: 'summary', title: '3-line AI summary + action', status: 'done' },
  { id: 'draft', title: 'Reply draft + copy', status: 'done' },
]

const PRIORITY_KEYWORDS = ['urgent', 'asap', 'action required', 'deadline', 'follow up', 'payment', 'invoice', 'meeting']
const LOW_PRIORITY_HINTS = ['newsletter', 'unsubscribe', 'promotion', 'sale', 'digest']

const randomString = (len = 64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let out = ''
  const arr = crypto.getRandomValues(new Uint8Array(len))
  for (const n of arr) out += chars[n % chars.length]
  return out
}

const base64Url = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Base64Url(input: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64Url(new Uint8Array(hash))
}

async function keychainSet(key: string, value: string) {
  await invoke('keychain_set', { key, value })
}

async function keychainGet(key: string): Promise<string | null> {
  try {
    return await invoke<string>('keychain_get', { key })
  } catch {
    return null
  }
}

async function keychainDelete(key: string) {
  try {
    await invoke('keychain_delete', { key })
  } catch {
    // ignore
  }
}

async function mailsSave(items: StoredMail[]) {
  try {
    await invoke('mails_save', { mails: items })
  } catch {
    localStorage.setItem('mailpilot.gmail.mails', JSON.stringify(items))
  }
}

async function mailsLoad(): Promise<StoredMail[]> {
  try {
    const rows = await invoke<StoredMail[]>('mails_load', { limit: 50 })
    return Array.isArray(rows) ? rows : []
  } catch {
    const fallback = localStorage.getItem('mailpilot.gmail.mails')
    if (!fallback) return []
    try {
      const parsed = JSON.parse(fallback) as StoredMail[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}

async function mailsClear() {
  try {
    await invoke('mails_clear')
  } catch {
    localStorage.removeItem('mailpilot.gmail.mails')
  }
}

function getHeader(headers: { name: string; value: string }[] | undefined, key: string) {
  const hit = headers?.find((h) => h.name.toLowerCase() === key.toLowerCase())
  return hit?.value ?? ''
}

function rankMail(item: MailItem): RankedMail {
  let score = 0
  const reasons: string[] = []
  const subjectLower = item.subject.toLowerCase()
  const fromLower = item.from.toLowerCase()
  const snippetLower = item.snippet.toLowerCase()

  for (const kw of PRIORITY_KEYWORDS) {
    if (subjectLower.includes(kw) || snippetLower.includes(kw)) {
      score += 2
      reasons.push(`keyword:${kw}`)
      break
    }
  }
  if (fromLower.includes('@gmail.com') || fromLower.includes('@qq.com')) {
    score += 1
    reasons.push('personal-sender')
  }
  if (subjectLower.startsWith('re:')) {
    score += 1
    reasons.push('active-thread')
  }
  for (const hint of LOW_PRIORITY_HINTS) {
    if (subjectLower.includes(hint) || snippetLower.includes(hint)) {
      score -= 2
      reasons.push(`low:${hint}`)
      break
    }
  }
  return { ...item, score, reasons }
}

function summarizeSnippet(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ['No content available.', '', '']
  const chunks = clean.match(/[^.!?。！？]{20,120}[.!?。！？]?/g) || [clean]
  return [chunks[0], chunks[1], chunks[2]].map((x) => (x || '').trim()).filter(Boolean)
}

function suggestAction(mail: RankedMail) {
  const text = `${mail.subject} ${mail.snippet}`.toLowerCase()
  if (mail.score >= 2 || text.includes('reply') || text.includes('confirm') || text.includes('approve')) return '回复'
  if (text.includes('meeting') || text.includes('schedule') || text.includes('tomorrow') || text.includes('today')) return '稍后'
  if (mail.score <= -1) return '归档'
  return '稍后'
}

function generateReplyDraft(mail: RankedMail, tone: DraftTone) {
  const summary = summarizeSnippet(mail.snippet)
  if (tone === 'friendly') {
    return `Hi,\n\nThanks for your email about "${mail.subject}".\n\nI reviewed this and my quick response is:\n- ${summary[0] || 'Got it.'}\n- ${summary[1] || 'I will follow up shortly.'}\n\nBest,\nDavy`
  }
  return `Hello,\n\nThank you for your message regarding "${mail.subject}".\n\nMy preliminary response:\n- ${summary[0] || 'Acknowledged.'}\n- ${summary[1] || 'I will review and follow up.'}\n\nRegards,\nDavy`
}

function App() {
  const [authCode, setAuthCode] = useState('')
  const [waitingCallback, setWaitingCallback] = useState(false)
  const [token, setToken] = useState<TokenResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mailLoading, setMailLoading] = useState(false)
  const [mails, setMails] = useState<MailItem[]>([])
  const [draftTone, setDraftTone] = useState<DraftTone>('professional')
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const canStart = useMemo(() => GOOGLE_CLIENT_ID.length > 10, [])
  const rankedTop5 = useMemo(() => mails.map(rankMail).sort((a, b) => b.score - a.score).slice(0, 5), [mails])

  useEffect(() => {
    const load = async () => {
      const fromKeychain = await keychainGet(KEYCHAIN_TOKEN_KEY)
      if (fromKeychain) {
        try {
          const parsed = JSON.parse(fromKeychain) as TokenResponse
          if (parsed.access_token) setToken(parsed)
        } catch {}
      }
      const parsedMails = await mailsLoad()
      if (parsedMails.length > 0) setMails(parsedMails)
    }
    void load()
  }, [])

  const exchangeCodeValue = async (codeValue: string) => {
    const verifier = await keychainGet(KEYCHAIN_PKCE_KEY)
    if (!verifier) throw new Error('No PKCE verifier found. Please restart login.')

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      code: codeValue.trim(),
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    })

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const payload = await res.json()
    if (!res.ok || !payload?.access_token) {
      throw new Error(payload?.error_description || payload?.error || `Token exchange failed: ${res.status}`)
    }

    const data = payload as TokenResponse
    setToken(data)
    await keychainSet(KEYCHAIN_TOKEN_KEY, JSON.stringify(data))
    await keychainDelete(KEYCHAIN_PKCE_KEY)
    setAuthCode('')
  }

  const startPkceLogin = async () => {
    setError('')
    setBusy(true)
    try {
      const verifier = randomString(64)
      const challenge = await sha256Base64Url(verifier)
      await keychainSet(KEYCHAIN_PKCE_KEY, verifier)

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: GMAIL_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
      })

      setWaitingCallback(true)
      const waitCodePromise = invoke<string>('oauth_wait_code', { timeoutSecs: 180 })
      await openUrl(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`)
      const callbackCode = await waitCodePromise
      await exchangeCodeValue(callbackCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete browser login')
    } finally {
      setWaitingCallback(false)
      setBusy(false)
    }
  }

  const exchangeCode = async () => {
    setError('')
    setBusy(true)
    try {
      await exchangeCodeValue(authCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code exchange failed')
    } finally {
      setBusy(false)
    }
  }

  const fetchMails = async () => {
    if (!token?.access_token) return
    setError('')
    setMailLoading(true)
    try {
      const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:7d', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (!listRes.ok) throw new Error(`Failed to list messages: ${listRes.status}`)

      const listJson = (await listRes.json()) as { messages?: GmailMessageListItem[] }
      const ids = listJson.messages ?? []
      if (ids.length === 0) {
        setMails([])
        await mailsSave([])
        return
      }

      const details = await Promise.all(
        ids.slice(0, 12).map(async (m) => {
          const detailRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token.access_token}` } },
          )
          if (!detailRes.ok) return null
          return (await detailRes.json()) as GmailMessage
        }),
      )

      const parsed: MailItem[] = details.filter((x): x is GmailMessage => Boolean(x)).map((msg) => {
        const headers = msg.payload?.headers
        return {
          id: msg.id,
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject') || '(No subject)',
          date: (() => {
            const d = getHeader(headers, 'Date')
            return d ? new Date(d).toLocaleString() : ''
          })(),
          snippet: msg.snippet ?? '',
        }
      })

      setMails(parsed)
      await mailsSave(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch mails')
    } finally {
      setMailLoading(false)
    }
  }

  const copyDraft = async (mail: RankedMail) => {
    await navigator.clipboard.writeText(generateReplyDraft(mail, draftTone))
    setCopiedId(mail.id)
    setTimeout(() => setCopiedId((current) => (current === mail.id ? null : current)), 1500)
  }

  const clearLocalData = async () => {
    await keychainDelete(KEYCHAIN_TOKEN_KEY)
    await keychainDelete(KEYCHAIN_PKCE_KEY)
    await mailsClear()
    setToken(null)
    setMails([])
    setExpandedDraftId(null)
    setCopiedId(null)
    setError('')
  }

  return (
    <main className="container">
      <header>
        <h1>MailPilot Local</h1>
        <p className="subtitle">Local-first AI email assistant for macOS</p>
      </header>

      <section className="card">
        <h2>Gmail 登录（浏览器授权）</h2>
        <p className="hint">点击“使用 Gmail 登录”后会自动跳转浏览器授权，并自动完成回调登录（无感）。若自动回调失败，可手动粘贴 code 作为兜底。</p>
        <div className="row">
          <button disabled={!canStart || busy} onClick={startPkceLogin}>{busy ? '处理中…' : '使用 Gmail 登录'}</button>
        </div>
        {waitingCallback && <p className="hint">正在等待浏览器授权回调，请完成 Google 登录…</p>}
        {!canStart && <p className="err">⚠️ 应用未配置 Google OAuth client_id（VITE_GOOGLE_CLIENT_ID）。</p>}

        <div className="row" style={{ marginTop: 8 }}>
          <input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="粘贴回调 URL 中的 code" />
          <button disabled={!authCode.trim() || busy} onClick={exchangeCode}>{busy ? '登录中…' : '完成登录'}</button>
        </div>

        {token && (
          <div className="oauth-box">
            <p className="ok">✅ Gmail connected.</p>
            <div className="actions">
              <button disabled={mailLoading} onClick={fetchMails}>{mailLoading ? 'Syncing…' : 'Fetch recent emails'}</button>
              <button className="secondary" onClick={clearLocalData}>Disconnect + Wipe Local Data</button>
            </div>
          </div>
        )}

        {error && <p className="err">⚠️ {error}</p>}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Top 5 Priority Emails</h2>
          <select value={draftTone} onChange={(e) => setDraftTone(e.target.value as DraftTone)}>
            <option value="professional">草稿语气：专业</option>
            <option value="friendly">草稿语气：友好</option>
          </select>
        </div>

        {rankedTop5.length === 0 ? <p className="hint">No ranked emails yet.</p> : (
          <div className="mail-list">
            {rankedTop5.map((m, idx) => {
              const draft = generateReplyDraft(m, draftTone)
              const expanded = expandedDraftId === m.id
              return (
                <article key={m.id} className="mail-item">
                  <h3>#{idx + 1} · {m.subject}</h3>
                  <p className="meta">Score: {m.score} · {m.reasons.join(', ') || 'baseline'}</p>
                  <p className="meta">From: {m.from}</p>
                  <p className="meta">建议动作：<strong>{suggestAction(m)}</strong></p>
                  <ul className="summary-list">{summarizeSnippet(m.snippet).map((line, i) => <li key={i}>{line}</li>)}</ul>
                  <div className="actions">
                    <button onClick={() => setExpandedDraftId(expanded ? null : m.id)}>{expanded ? '隐藏草稿' : '生成草稿'}</button>
                    <button onClick={() => copyDraft(m)}>{copiedId === m.id ? '已复制' : '复制草稿'}</button>
                  </div>
                  {expanded && <textarea className="draft" value={draft} readOnly rows={7} />}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent Emails (last 7 days)</h2>
        {mails.length === 0 ? <p className="hint">No emails loaded yet.</p> : (
          <div className="mail-list">
            {mails.map((m) => (
              <article key={m.id} className="mail-item">
                <h3>{m.subject}</h3>
                <p className="meta">From: {m.from}</p>
                <p className="meta">Date: {m.date}</p>
                <p>{m.snippet}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Build Checklist</h2>
        <div className="list">
          {tasks.map((task) => (
            <div key={task.id} className="item">
              <span className={`badge ${task.status}`}>{task.status}</span>
              <span>{task.title}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
