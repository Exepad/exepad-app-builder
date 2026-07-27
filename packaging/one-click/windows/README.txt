Exepad - one-click install (Windows)
====================================

1. Extract this ZIP somewhere (right-click the ZIP -> Extract All...).

2. Double-click "Install Exepad.bat".
   If SmartScreen shows "Windows protected your PC", click
   "More info" -> "Run anyway" (expected for unsigned downloads).

3. If Docker Desktop is not installed yet, the installer opens its download
   page. Install it, start it (whale icon in the tray, wait for
   "Engine running"), then double-click "Install Exepad.bat" again.

4. When it finishes, the studio opens at http://localhost:8080.
   Create your operator account and paste your LLM API key in Settings.

Requirements
------------
- Windows 10/11 64-bit
- Docker Desktop (the installer guides you; WSL 2 may need a reboot)
- 8 GB RAM recommended (builds peak at 2-3 GB)


Manage it later
---------------
Re-run "Install Exepad.bat" any time to update to this package's version.
Node 18+ users also get the operator CLI:  npx exepad status | stop | start | update | backup

Your data lives in the Docker volume "exepad-data" - reinstalling or
updating never touches it.
