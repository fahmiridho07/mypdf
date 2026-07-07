use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde_json::Value;
use tauri::{Emitter, Manager};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const ENGINE_SOURCE: &str = include_str!("../../engine/pdf_engine.py");

static PYTHON: OnceLock<Result<String, String>> = OnceLock::new();

fn find_python() -> Result<String, String> {
    PYTHON
        .get_or_init(|| {
            for candidate in ["python", "python3", "py"] {
                let mut cmd = Command::new(candidate);
                cmd.arg("--version")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                if matches!(cmd.status(), Ok(s) if s.success()) {
                    return Ok(candidate.to_string());
                }
            }
            Err("Python was not found on this machine. Install it from python.org, then reopen the app.".into())
        })
        .clone()
}

/// Write the embedded engine script to the app data dir so it works both in
/// `tauri dev` and in a bundled installation.
fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("pdf_engine.py");
    let stale = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != ENGINE_SOURCE,
        Err(_) => true,
    };
    if stale {
        std::fs::write(&path, ENGINE_SOURCE).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
async fn run_engine(app: tauri::AppHandle, task: String, params: Value) -> Result<Value, String> {
    let python = find_python()?;
    let script = engine_path(&app)?;

    let request = serde_json::json!({ "task": task, "params": params });
    let emitter = app.clone();
    let task_name = task.clone();

    let (last_line, stderr_text) = tauri::async_runtime::spawn_blocking(
        move || -> Result<(String, String), String> {
            let mut cmd = Command::new(&python);
            cmd.arg(&script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let mut child = cmd.spawn().map_err(|e| format!("could not start python: {e}"))?;
            child
                .stdin
                .take()
                .ok_or("stdin unavailable")?
                .write_all(request.to_string().as_bytes())
                .map_err(|e| e.to_string())?;
            drop(child.stdin.take());

            // Stream stdout: progress lines become window events, the last
            // JSON line is the result.
            use std::io::{BufRead, BufReader, Read};
            let stdout = child.stdout.take().ok_or("stdout unavailable")?;
            let mut last = String::new();
            for line in BufReader::new(stdout).lines() {
                let line = line.map_err(|e| e.to_string())?;
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if v.get("progress").is_some() {
                        let _ = emitter.emit(
                            "engine-progress",
                            serde_json::json!({
                                "task": task_name,
                                "done": v["progress"],
                                "total": v["total"],
                            }),
                        );
                        continue;
                    }
                }
                last = line;
            }
            let mut stderr_s = String::new();
            if let Some(mut se) = child.stderr.take() {
                let _ = se.read_to_string(&mut stderr_s);
            }
            child.wait().map_err(|e| e.to_string())?;
            Ok((last, stderr_s))
        },
    )
    .await
    .map_err(|e| e.to_string())??;

    let parsed: Value = serde_json::from_str(last_line.trim()).map_err(|_| {
        format!(
            "Engine error: {}",
            if stderr_text.is_empty() { last_line.clone() } else { stderr_text.clone() }
        )
    })?;

    if parsed["ok"].as_bool() == Some(true) {
        Ok(parsed["result"].clone())
    } else {
        Err(parsed["error"].as_str().unwrap_or("unknown error").to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_engine])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
