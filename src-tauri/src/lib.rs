//! Olive Studio desktop shell (Tauri).
//!
//! Architecture: native window + WebView pointed at the existing Node/Express
//! server (`dist/server.cjs` or `pnpm dev`). Olive/Python stays in Node.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent};

const DEFAULT_PORT: u16 = 3000;
const HEALTH_TIMEOUT_SECS: u64 = 90;

struct SidecarState {
  child: Mutex<Option<Child>>,
}

fn resolve_app_root(app: &AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    // src-tauri/ → repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .canonicalize()
      .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
  } else {
    // Prefer resource dir (bundled dist/scripts); fall back to executable directory.
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

  // Hide console window for the Node process on Windows release builds.
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

fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
  let deadline = Instant::now() + timeout;
  let host = format!("127.0.0.1:{port}");
  let request = format!(
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );

  while Instant::now() < deadline {
    // Fast path: port open
    if TcpStream::connect_timeout(
      &format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?,
      Duration::from_millis(400),
    )
    .is_ok()
    {
      if let Ok(mut stream) = TcpStream::connect(&host) {
        use std::io::{Read, Write};
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        if stream.write_all(request.as_bytes()).is_ok() {
          let mut buf = vec![0u8; 512];
          if let Ok(n) = stream.read(&mut buf) {
            let body = String::from_utf8_lossy(&buf[..n]);
            if body.contains("200") && body.contains("\"ok\"") {
              return Ok(());
            }
            // Server up but health not ready yet — also accept any 200 HTML root
            if body.starts_with("HTTP/1.") && body.contains("200") {
              return Ok(());
            }
          }
        }
      }
    }
    thread::sleep(Duration::from_millis(350));
  }

  Err(format!(
    "Olive Studio server did not become ready on http://127.0.0.1:{port} within {}s.\n\
     Check that port {port} is free and Node can run `dist/server.cjs`.",
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
        // `beforeDevCommand` (`pnpm dev`) starts the Express/Vite server.
        // Wait so the WebView does not open on a dead connection.
        if let Err(e) = wait_for_health(port, Duration::from_secs(HEALTH_TIMEOUT_SECS)) {
          log::error!("{e}");
          eprintln!("[olive-studio] {e}");
          // Still allow the window — user may start the server manually.
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
