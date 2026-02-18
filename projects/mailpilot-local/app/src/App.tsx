import './App.css'

type Task = {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
}

const tasks: Task[] = [
  { id: 'auth', title: 'Gmail OAuth login + Keychain token', status: 'todo' },
  { id: 'sync', title: 'Fetch last 7 days emails', status: 'todo' },
  { id: 'rank', title: 'Top 5 priority scoring', status: 'todo' },
  { id: 'summary', title: '3-line AI summary + action', status: 'todo' },
  { id: 'draft', title: 'Reply draft + copy', status: 'todo' },
]

function App() {
  return (
    <main className="container">
      <header>
        <h1>MailPilot Local</h1>
        <p className="subtitle">Local-first AI email assistant for macOS</p>
      </header>

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
