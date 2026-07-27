//! Olive Studio desktop shell (Tauri).
//!
//! Architecture: native window + WebView pointed at the existing Node/Express
//! server (`dist/server.mjs` or `pnpm dev`). Olive/Python stays in Node.
//!
//! Critical: the WebView must load `http://127.0.0.1:PORT` (the Express app),
//! never the asset-protocol frontend alone — otherwise relative `fetch("/api/...")`
//! fails with "Failed to fetch".

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url};

const DEFAULT_PORT: u16 = 3000;
const HEALTH_TIMEOUT_SECS: u64 = 120;

struct SidecarState {
  child: Mutex<Option<Child>>,
}

fn resolve_app_root(app: &AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .canonicalize()
      .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
  } else {
    app
      .path()
      .resource_dir()
      .ok()
      .and_then(|p| p.canonicalize().ok())
      .or_else(|| {
        std::env::current_exe()
          .ok()
          .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
      })
      .unwrap_or_else(|| PathBuf::from("."))
  }
}

fn server_entry(root: &Path) -> PathBuf {
  let mjs = root.join("dist").join("server.mjs");
  if mjs.is_file() {
    return mjs;
  }
  root.join("dist").join("server.cjs")
}

fn spawn_node_server(root: &Path, port: u16) -> Result<Child, String> {
  let entry = server_entry(root);
  if !entry.is_file() {
    return Err(format!(
      "Production build not found at {}.\nRun `pnpm build` then try again.",
      entry.display()
    ));
  }

  let mut cmd = Command::new("node");
  cmd
    .arg(&entry)
    .current_dir(root)
    .env("PORT", port.to_string())
    .env("NODE_ENV", "production")
    .env("OLIVE_DIST_DIR", root.join("dist"))
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  cmd.spawn().map_err(|e| {
    format!(
      "Failed to start Node server: {e}\nIs Node.js 22+ installed and on PATH?"
    )
  })
}

/// Wait until Express reports ready (and Vite warmup finished in dev).
/// Rejects "port open but half-ready" — that was causing every UI module to
/// "Failed to fetch" while Vite was still optimizing deps.
fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
  let deadline = Instant::now() + timeout;
  let addr = format!("127.0.0.1:{port}");
  let request = format!(
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );

  while Instant::now() < deadline {
    if let Ok(mut stream) = TcpStream::connect_timeout(
      &addr
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?,
      Duration::from_millis(500),
    ) {
      let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
      let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
      if stream.write_all(request.as_bytes()).is_ok() {
        let mut buf = vec![0u8; 1024];
        if let Ok(n) = stream.read(&mut buf) {
          let body = String::from_utf8_lossy(&buf[..n]);
          // Require explicit ready flag from our health endpoint
          if body.contains("200")
            && (body.contains("\"ready\":true") || body.contains("\"ok\":true"))
            && !body.contains("\"ready\":false")
          {
            return Ok(());
          }
        }
      }
    }
    thread::sleep(Duration::from_millis(400));
  }

  Err(format!(
    "Olive Studio server did not become ready on http://127.0.0.1:{port} within {}s.\n\
     Check that port {port} is free and `pnpm dev` / `dist/server.mjs` is running.",
    timeout.as_secs()
  ))
}

fn kill_sidecar(child: &mut Child) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let pid = child.id();
    let _ = Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/T", "/F"])
      .creation_flags(CREATE_NO_WINDOW)
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
  #[cfg(not(windows))]
  {
    let _ = child.kill();
    let _ = child.wait();
  }
}

fn stop_managed_sidecar(state: &SidecarState) {
  let Ok(mut guard) = state.child.lock() else {
    return;
  };
  if let Some(mut child) = guard.take() {
    kill_sidecar(&mut child);
  }
}

fn navigate_main_to_server(app: &AppHandle, port: u16) {
  let url_str = format!("http://127.0.0.1:{port}/");
  if let Some(win) = app.get_webview_window("main") {
    match Url::parse(&url_str) {
      Ok(url) => {
        if let Err(e) = win.navigate(url) {
          log::warn!("navigate failed: {e}");
          eprintln!("[olive-studio] navigate failed: {e}");
        }
      }
      Err(e) => {
        log::warn!("bad url: {e}");
      }
    }
    let _ = win.show();
    let _ = win.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let port: u16 = std::env::var("PORT")
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(DEFAULT_PORT);

  tauri::Builder::default()
    .manage(SidecarState {
      child: Mutex::new(None),
    })
    .setup(move |app| {
      if cfg!(debug_assertions) {
        // `beforeDevCommand` (`pnpm dev`) starts Express+Vite.
        if let Err(e) = wait_for_health(port, Duration::from_secs(HEALTH_TIMEOUT_SECS)) {
          log::error!("{e}");
          eprintln!("[olive-studio] {e}");
        }
      } else {
        let root = resolve_app_root(app.handle());
        log::info!("App root: {}", root.display());
        match spawn_node_server(&root, port) {
          Ok(child) => {
            if let Ok(mut guard) = app.state::<SidecarState>().child.lock() {
              *guard = Some(child);
            }
            if let Err(e) = wait_for_health(port, Duration::from_secs(HEALTH_TIMEOUT_SECS)) {
              log::error!("{e}");
              eprintln!("[olive-studio] {e}");
              stop_managed_sidecar(&app.state::<SidecarState>());
              return Err(e.into());
            }
          }
          Err(e) => {
            log::error!("{e}");
            eprintln!("[olive-studio] {e}");
            return Err(e.into());
          }
        }
      }

      // Always land on Express origin so relative fetch("/api/...") works.
      navigate_main_to_server(app.handle(), port);

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
        stop_managed_sidecar(&app_handle.state::<SidecarState>());
      }
    });
}
