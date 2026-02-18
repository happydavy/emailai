use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "mailpilot-local";

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
            // NotFound is effectively already deleted; keep UX simple.
            let msg = err.to_string();
            if msg.to_lowercase().contains("not found") {
                Ok(())
            } else {
                Err(msg)
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![keychain_set, keychain_get, keychain_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
