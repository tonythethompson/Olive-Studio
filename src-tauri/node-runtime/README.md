# Bundled Linux Node runtime

Official Linux release and CI workflows replace this directory's placeholder
contents with the Node 22 executable before Tauri packages resources. It lets
the packaged desktop sidecar start without a system Node installation.

Local development and locally-built packages fall back to `node` on `PATH`.
