import { useMemo, useState } from 'react'
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

const GOOGLE_DEVICE_CODE_ENDPOINT = 'https://oauth2.googleapis.com/device/code'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

const tasks: Task[] = [
  { id: 'auth', title: 'Gmail OAuth login + Keychain token', status: 'doing' },
  { id: 'sync', title: 'Fetch last 7 days emails', status: 'todo' },
  { id: 'rank', title: 'Top 5 priority scoring', status: 'todo' },
  { id: 'summary', title: '3-line AI summary + action', status: 'todo' },
  { id: 'draft', title: 'Reply draft + copy', status: 'todo' },
]

function App() {
  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null)
  const [token, setToken] = useState<TokenResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(false)

  const canStart = useMemo(() => clientId.trim().length > 10, [clientId])

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
              1) Open: <a href={device.verification_url} target="_blank" rel="noreferrer">{device.verification_url}</a>
            </p>
            <p>
              2) Enter code: <strong>{device.user_code}</strong>
            </p>
            <button disabled={polling} onClick={pollForToken}>
              {polling ? 'Waiting authorization…' : 'I authorized, continue'}
            </button>
          </div>
        )}

        {token && <p className="ok">✅ Gmail connected (token saved locally for dev).</p>}
        {error && <p className="err">⚠️ {error}</p>}
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
