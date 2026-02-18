use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

const KEYCHAIN_SERVICE: &str = "mailpilot-local";

#[derive(Debug, Serialize, Deserialize)]
struct MailItem {
    id: String,
    from: String,
    subject: String,
    date: String,
    snippet: String,
}

fn db_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(home)
        .join(".mailpilot")
        .join("mailpilot_local.db"))
}

fn with_db<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let path = db_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mails (
          id TEXT PRIMARY KEY,
          sender TEXT NOT NULL,
          subject TEXT NOT NULL,
          date TEXT NOT NULL,
          snippet TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    f(&conn)
}

#[tauri::command]
fn keychain_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(key: String) -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(err) => {
            let msg = err.to_string();
            if msg.to_lowercase().contains("not found") {
                Ok(())
            } else {
                Err(msg)
            }
        }
    }
}

#[tauri::command]
fn mails_save(mails: Vec<MailItem>) -> Result<(), String> {
    with_db(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for m in mails {
            tx.execute(
                "
                INSERT INTO mails(id, sender, subject, date, snippet, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
                ON CONFLICT(id) DO UPDATE SET
                  sender=excluded.sender,
                  subject=excluded.subject,
                  date=excluded.date,
                  snippet=excluded.snippet,
                  updated_at=strftime('%s','now')
                ",
                params![m.id, m.from, m.subject, m.date, m.snippet],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn mails_load(limit: Option<i64>) -> Result<Vec<MailItem>, String> {
    with_db(|conn| {
        let lim = limit.unwrap_or(50).max(1);
        let mut stmt = conn
            .prepare(
                "SELECT id, sender, subject, date, snippet FROM mails ORDER BY updated_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![lim], |row| {
                Ok(MailItem {
                    id: row.get(0)?,
                    from: row.get(1)?,
                    subject: row.get(2)?,
                    date: row.get(3)?,
                    snippet: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
fn mails_clear() -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM mails", []).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn oauth_wait_code(timeout_secs: Option<u64>) -> Result<String, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(180).max(30));
    let listener = TcpListener::bind("127.0.0.1:8765").map_err(|e| e.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    while start.elapsed() < timeout {
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let mut buffer = [0u8; 4096];
                let n = stream.read(&mut buffer).map_err(|e| e.to_string())?;
                let req = String::from_utf8_lossy(&buffer[..n]);
                let first_line = req.lines().next().unwrap_or_default();

                let mut code = String::new();
                if let Some(path_start) = first_line.split_whitespace().nth(1) {
                    if let Some(query) = path_start.split('?').nth(1) {
                        for pair in query.split('&') {
                            let mut it = pair.splitn(2, '=');
                            let k = it.next().unwrap_or_default();
                            let v = it.next().unwrap_or_default();
                            if k == "code" {
                                code = urlencoding::decode(v)
                                    .map_err(|e| e.to_string())?
                                    .to_string();
                                break;
                            }
                        }
                    }
                }

                let body = if code.is_empty() {
                    "<html><body><h3>Login failed: missing code.</h3></body></html>"
                } else {
                    "<html><body><h3>Login successful. You can return to MailPilot now.</h3></body></html>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if code.is_empty() {
                    return Err("Missing OAuth code in callback URL".to_string());
                }
                return Ok(code);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    Err("Timed out waiting for OAuth callback".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            keychain_set,
            keychain_get,
            keychain_delete,
            mails_save,
            mails_load,
            mails_clear,
            oauth_wait_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
