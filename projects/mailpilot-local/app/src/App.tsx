import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Task = {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_url: string
  expires_in: number
  interval: number
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
  internalDate: string
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

const GOOGLE_DEVICE_CODE_ENDPOINT = 'https://oauth2.googleapis.com/device/code'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

const tasks: Task[] = [
  { id: 'auth', title: 'Gmail OAuth login + Keychain token', status: 'done' },
  { id: 'sync', title: 'Fetch last 7 days emails', status: 'done' },
  { id: 'rank', title: 'Top 5 priority scoring', status: 'done' },
  { id: 'summary', title: '3-line AI summary + action', status: 'doing' },
  { id: 'draft', title: 'Reply draft + copy', status: 'todo' },
]

const PRIORITY_KEYWORDS = ['urgent', 'asap', 'action required', 'deadline', 'follow up', 'payment', 'invoice', 'meeting']
const LOW_PRIORITY_HINTS = ['newsletter', 'unsubscribe', 'promotion', 'sale', 'digest']

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
  const line1 = chunks[0] || clean.slice(0, 90)
  const line2 = chunks[1] || clean.slice(90, 180)
  const line3 = chunks[2] || clean.slice(180, 270)

  return [line1, line2, line3].map((x) => (x || '').trim()).filter(Boolean)
}

function suggestAction(mail: RankedMail) {
  const text = `${mail.subject} ${mail.snippet}`.toLowerCase()
  if (mail.score >= 2 || text.includes('reply') || text.includes('confirm') || text.includes('approve')) {
    return '回复'
  }
  if (text.includes('meeting') || text.includes('schedule') || text.includes('tomorrow') || text.includes('today')) {
    return '稍后'
  }
  if (mail.score <= -1) {
    return '归档'
  }
  return '稍后'
}

function App() {
  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null)
  const [token, setToken] = useState<TokenResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(false)
  const [mailLoading, setMailLoading] = useState(false)
  const [mails, setMails] = useState<MailItem[]>([])

  const canStart = useMemo(() => clientId.trim().length > 10, [clientId])

  const rankedTop5 = useMemo(() => {
    return mails.map(rankMail).sort((a, b) => b.score - a.score).slice(0, 5)
  }, [mails])

  useEffect(() => {
    const saved = localStorage.getItem('mailpilot.gmail.token')
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as TokenResponse
      if (parsed.access_token) setToken(parsed)
    } catch {
      // ignore
    }
  }, [])

  const startDeviceFlow = async () => {
    setError('')
    setToken(null)
    setBusy(true)
    try {
      const body = new URLSearchParams({
        client_id: clientId.trim(),
        scope: GMAIL_SCOPE,
      })
      const res = await fetch(GOOGLE_DEVICE_CODE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!res.ok) throw new Error(`Device flow failed: ${res.status}`)
      const data = (await res.json()) as DeviceCodeResponse
      setDevice(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start OAuth')
    } finally {
      setBusy(false)
    }
  }

  const pollForToken = async () => {
    if (!device) return
    setError('')
    setPolling(true)
    const started = Date.now()

    while (Date.now() - started < device.expires_in * 1000) {
      try {
        const body = new URLSearchParams({
          client_id: clientId.trim(),
          device_code: device.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        })

        const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })

        const payload = await res.json()

        if (res.ok && payload?.access_token) {
          const data = payload as TokenResponse
          setToken(data)
          localStorage.setItem('mailpilot.gmail.token', JSON.stringify(data))
          setPolling(false)
          return
        }

        if (payload?.error === 'authorization_pending') {
          await new Promise((r) => setTimeout(r, (device.interval || 5) * 1000))
          continue
        }

        if (payload?.error === 'slow_down') {
          await new Promise((r) => setTimeout(r, (device.interval + 3) * 1000))
          continue
        }

        throw new Error(payload?.error || 'Token polling failed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Token polling failed')
        setPolling(false)
        return
      }
    }

    setError('Authorization timed out. Start again.')
    setPolling(false)
  }

  const fetchMails = async () => {
    if (!token?.access_token) return
    setError('')
    setMailLoading(true)
    try {
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:7d',
        {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
          },
        },
      )

      if (!listRes.ok) {
        throw new Error(`Failed to list messages: ${listRes.status}`)
      }

      const listJson = (await listRes.json()) as { messages?: GmailMessageListItem[] }
      const ids = listJson.messages ?? []
      if (ids.length === 0) {
        setMails([])
        setMailLoading(false)
        return
      }

      const details = await Promise.all(
        ids.slice(0, 12).map(async (m) => {
          const detailRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            {
              headers: {
                Authorization: `Bearer ${token.access_token}`,
              },
            },
          )
          if (!detailRes.ok) return null
          return (await detailRes.json()) as GmailMessage
        }),
      )

      const parsed: MailItem[] = details
        .filter((x): x is GmailMessage => Boolean(x))
        .map((msg) => {
          const headers = msg.payload?.headers
          const from = getHeader(headers, 'From')
          const subject = getHeader(headers, 'Subject') || '(No subject)'
          const dateRaw = getHeader(headers, 'Date')
          const date = dateRaw ? new Date(dateRaw).toLocaleString() : ''
          return {
            id: msg.id,
            from,
            subject,
            date,
            snippet: msg.snippet ?? '',
          }
        })

      setMails(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch mails')
    } finally {
      setMailLoading(false)
    }
  }

  return (
    <main className="container">
      <header>
        <h1>MailPilot Local</h1>
        <p className="subtitle">Local-first AI email assistant for macOS</p>
      </header>

      <section className="card">
        <h2>Step 1 · Gmail OAuth (Device Flow)</h2>
        <p className="hint">
          Paste your Google OAuth <code>client_id</code> (Desktop App), then connect Gmail.
        </p>

        <div className="row">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Google OAuth Client ID"
          />
          <button disabled={!canStart || busy} onClick={startDeviceFlow}>
            {busy ? 'Starting…' : 'Connect Gmail'}
          </button>
        </div>

        {device && (
          <div className="oauth-box">
            <p>
              1) Open:{' '}
              <a href={device.verification_url} target="_blank" rel="noreferrer">
                {device.verification_url}
              </a>
            </p>
            <p>
              2) Enter code: <strong>{device.user_code}</strong>
            </p>
            <button disabled={polling} onClick={pollForToken}>
              {polling ? 'Waiting authorization…' : 'I authorized, continue'}
            </button>
          </div>
        )}

        {token && (
          <div className="oauth-box">
            <p className="ok">✅ Gmail connected.</p>
            <button disabled={mailLoading} onClick={fetchMails}>
              {mailLoading ? 'Syncing…' : 'Fetch recent emails'}
            </button>
          </div>
        )}

        {error && <p className="err">⚠️ {error}</p>}
      </section>

      <section className="card">
        <h2>Top 5 Priority Emails</h2>
        {rankedTop5.length === 0 ? (
          <p className="hint">No ranked emails yet.</p>
        ) : (
          <div className="mail-list">
            {rankedTop5.map((m, idx) => (
              <article key={m.id} className="mail-item">
                <h3>
                  #{idx + 1} · {m.subject}
                </h3>
                <p className="meta">Score: {m.score} · {m.reasons.join(', ') || 'baseline'}</p>
                <p className="meta">From: {m.from}</p>
                <p className="meta">建议动作：<strong>{suggestAction(m)}</strong></p>
                <ul className="summary-list">
                  {summarizeSnippet(m.snippet).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent Emails (last 7 days)</h2>
        {mails.length === 0 ? (
          <p className="hint">No emails loaded yet.</p>
        ) : (
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
        <h2>MVP Scope</h2>
        <ul>
          <li>Gmail read-only integration</li>
          <li>Top 5 important emails</li>
          <li>3-line summary and recommended action</li>
          <li>Reply draft (copy to clipboard)</li>
          <li>Local storage + one-click data wipe</li>
        </ul>
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
