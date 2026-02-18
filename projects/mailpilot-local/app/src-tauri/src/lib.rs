use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

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
            mails_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
