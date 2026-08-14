#!/bin/sh
# Soft prerequisite: the GUI works without Python. Live Olive runs need 3.10–3.13.
if ! command -v python3 >/dev/null 2>&1; then
  echo "Olive Studio: Python 3.10–3.13 (3.12 recommended) is needed for live Olive runs."
  echo "Install with: sudo apt install -y python3 python3-venv python3-pip"
  echo "Or download: https://www.python.org/downloads/"
fi
exit 0
