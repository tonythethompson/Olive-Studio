; Optional Python prompt after Olive Studio is installed.
; Does not fail setup if Python is missing — the GUI works without it.

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$LOCALAPPDATA\Programs\Python\Python312\python.exe" olive_have_py 0
  IfFileExists "$LOCALAPPDATA\Programs\Python\Python311\python.exe" olive_have_py 0
  IfFileExists "$LOCALAPPDATA\Programs\Python\Python313\python.exe" olive_have_py 0
  IfFileExists "$LOCALAPPDATA\Programs\Python\Python310\python.exe" olive_have_py 0
  IfFileExists "$LOCALAPPDATA\Python\bin\python3.12.exe" olive_have_py 0
  IfFileExists "$LOCALAPPDATA\Python\bin\python.exe" olive_have_py 0
  IfFileExists "$PROGRAMFILES\Python312\python.exe" olive_have_py 0
  IfFileExists "$PROGRAMFILES\Python311\python.exe" olive_have_py 0
  IfFileExists "$PROGRAMFILES\Python313\python.exe" olive_have_py 0
  IfFileExists "$PROGRAMFILES\Python310\python.exe" olive_have_py 0

  MessageBox MB_YESNO|MB_ICONINFORMATION \
    "Olive Studio can open without Python. Live Olive runs need Python 3.10–3.13 (3.12 recommended).$\r$\n$\r$\nInstall Python 3.12 now? This uses Windows Package Manager when available, otherwise opens the download page." \
    IDNO olive_skip_py

  nsExec::ExecToLog 'winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --disable-interactivity'
  Pop $R9
  IntCmp $R9 0 olive_have_py olive_open_dl olive_open_dl

  olive_open_dl:
    ExecShell "open" "https://www.python.org/downloads/windows/"
    Goto olive_skip_py

  olive_have_py:
  olive_skip_py:
!macroend
