//! Olive Studio desktop shell (Tauri).
//!
//! Architecture: native window + WebView pointed at the existing Node/Express
//! server (`dist/server.mjs` or `pnpm dev`). Olive/Python stays in Node.
//!
//! Critical: the WebView must load `http://127.0.0.1:PORT` (the Express app),
//! never the asset-protocol frontend alone — otherwise relative `fetch("/api/...")`
//! fails with "Failed to fetch".

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

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

/// Release workflows place a Node 22 runtime in this resource path.
/// Development builds and locally-built packages can still use the Node binary
/// on PATH as a fallback.
fn node_executable(root: &Path) -> PathBuf {
  #[cfg(target_os = "linux")]
  {
    let bundled = root.join("node-runtime").join("node");
    if bundled.is_file() {
      return bundled;
    }
  }

  #[cfg(target_os = "macos")]
  {
    let bundled = root.join("node-runtime").join("node");
    if bundled.is_file() {
      return bundled;
    }
  }

  #[cfg(target_os = "windows")]
  {
    let bundled = root.join("node-runtime").join("node.exe");
    if bundled.is_file() {
      return bundled;
    }
  }

  PathBuf::from("node")
}

/// Picks an ephemeral loopback port and spawns the Node server on it.
/// Returns both the child process and the assigned port.
fn spawn_node_server(root: &Path) -> Result<(Child, u16), String> {
  let entry = server_entry(root);
  if !entry.is_file() {
    return Err(format!(
      "Production build not found at {}.\nRun `pnpm build` then try again.",
      entry.display()
    ));
  }

  // Bind to port 0 to let OS assign a free port, then close the listener
  let listener = TcpListener::bind("127.0.0.1:0")
    .map_err(|e| format!("Failed to allocate ephemeral port: {e}"))?;
  let port = listener.local_addr()
    .map_err(|e| format!("Failed to read assigned port: {e}"))?
    .port();
  drop(listener);

  let node = node_executable(root);
  let mut cmd = Command::new(&node);
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

  let child = cmd.spawn().map_err(|e| {
    format!(
      "Failed to start Node server with {}: {e}\nInstall Node.js 22+ or use a packaged build that includes the bundled runtime.",
      node.display()
    )
  })?;

  Ok((child, port))
}

/// Wait until Express reports ready (and Vite warmup finished in dev).
/// Rejects "port open but half-ready" — that was causing every UI module to
/// "Failed to fetch" while Vite was still optimizing deps.
/// Also verifies the child process is still alive (if provided).
fn wait_for_health(
  port: u16,
  timeout: Duration,
  mut child: Option<&mut Child>,
) -> Result<(), String> {
  let deadline = Instant::now() + timeout;
  let addr = format!("127.0.0.1:{port}");
  let request = format!(
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );

  while Instant::now() < deadline {
    // If a child process was provided, verify it's still running
    if let Some(ref mut c) = child {
      match c.try_wait() {
        Ok(Some(status)) => {
          return Err(format!(
            "Node server process exited prematurely with status: {status}"
          ));
        }
        Err(e) => {
          return Err(format!("Failed to check child process status: {e}"));
        }
        Ok(None) => {
          // Process still running, continue
        }
      }
    }

    if let Ok(mut stream) = TcpStream::connect_timeout(
      &addr
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?,
      Duration::from_millis(500),
    ) {
      let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
      let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
      if stream.write_all(request.as_bytes()).is_ok() {
        let mut buf = vec![0u8; 4096];
        if let Ok(n) = stream.read(&mut buf) {
          let response = String::from_utf8_lossy(&buf[..n]);

          // Parse HTTP status code from response line
          let status_ok = response
            .lines()
            .next()
            .and_then(|line| {
              // HTTP/1.1 200 OK
              line.split_whitespace()
                .nth(1)
                .and_then(|code| code.parse::<u16>().ok())
            })
            .map(|code| code == 200)
            .unwrap_or(false);

          if !status_ok {
            thread::sleep(Duration::from_millis(400));
            continue;
          }

          // Split headers and body
          let body = response
            .split("\r\n\r\n")
            .nth(1)
            .unwrap_or("");

          // Accept Express /api/health shapes:
          //   { "status":"ok", "ready":true, "ok":true, ... }
          // Reject half-ready: { "status":"starting", "ready":false } or 503 body.
          let has_ready_true =
            body.contains("\"ready\":true") || body.contains("\"ready\": true");
          let has_ok_true = body.contains("\"ok\":true") || body.contains("\"ok\": true");
          let has_status_ok =
            body.contains("\"status\":\"ok\"") || body.contains("\"status\": \"ok\"");
          let has_ready_false =
            body.contains("\"ready\":false") || body.contains("\"ready\": false");

          if (has_ready_true || has_ok_true || has_status_ok) && !has_ready_false {
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
      let actual_port: u16;

      if cfg!(debug_assertions) {
        // `beforeDevCommand` (`pnpm dev`) starts Express+Vite.
        // In debug mode, use the configured PORT env var or default
        actual_port = port;
        // Fix Issue 3 & 4: Return error on health check failure instead of continuing
        if let Err(e) = wait_for_health(actual_port, Duration::from_secs(HEALTH_TIMEOUT_SECS), None) {
          log::error!("{e}");
          eprintln!("[olive-studio] {e}");
          return Err(e.into());
        }
      } else {
        let root = resolve_app_root(app.handle());
        log::info!("App root: {}", root.display());
        match spawn_node_server(&root) {
          Ok((mut child, assigned_port)) => {
            actual_port = assigned_port;
            log::info!("Node server started on port {}", actual_port);

            // Wait for health and verify process is still alive
            if let Err(e) = wait_for_health(actual_port, Duration::from_secs(HEALTH_TIMEOUT_SECS), Some(&mut child)) {
              log::error!("{e}");
              eprintln!("[olive-studio] {e}");
              kill_sidecar(&mut child);
              return Err(e.into());
            }

            // Store the child process in state
            if let Ok(mut guard) = app.state::<SidecarState>().child.lock() {
              *guard = Some(child);
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
      navigate_main_to_server(app.handle(), actual_port);

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Shell plugin for opening external URLs (GitHub, mailto, etc.)
      app.handle().plugin(tauri_plugin_shell::init())?;
      app.handle().plugin(tauri_plugin_dialog::init())?;

      // Updater plugin: private key is CI-only ($TAURI_SIGNING_PRIVATE_KEY).
      // Runtime verification uses plugins.updater.pubkey in tauri.conf.json.
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      if !cfg!(debug_assertions) {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          // Windows install runs on_before_exit then std::process::exit(0), which
          // skips RunEvent::Exit. Stop the Node sidecar there so it is not orphaned.
          let cleanup_handle = handle.clone();
          match handle
            .updater_builder()
            .on_before_exit(move || {
              stop_managed_sidecar(&cleanup_handle.state::<SidecarState>());
              cleanup_handle.cleanup_before_exit();
            })
            .build()
          {
            Ok(updater) => match updater.check().await {
              Ok(Some(update)) => {
                log::info!(
                  "found update v{} (current: v{})",
                  update.version,
                  update.current_version
                );
                // Require consent before install: Windows exits the process during
                // install, which would otherwise kill an in-flight Olive job.
                let dialog_handle = handle.clone();
                let version = update.version.clone();
                let accepted = tauri::async_runtime::spawn_blocking(move || {
                  dialog_handle
                    .dialog()
                    .message(format!(
                      "Olive Studio v{version} is available.\n\nInstall now? The app will close and restart. Choose Cancel if an optimization or other work is still running."
                    ))
                    .title("Update available")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancel)
                    .blocking_show()
                })
                .await
                .unwrap_or(false);

                if !accepted {
                  log::info!("update v{} deferred by user", update.version);
                  return;
                }

                if let Err(e) = update.download_and_install(|_chunk, _total| {}, || {}).await {
                  log::error!("failed to download and install update: {e}");
                } else {
                  log::info!(
                    "update v{} downloaded and installed successfully",
                    update.version
                  );
                }
              }
              Ok(None) => {
                log::info!("no update available");
              }
              Err(e) => log::warn!("updater check failed: {e}"),
            },
            Err(e) => log::warn!("updater unavailable: {e}"),
          }
        });
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
