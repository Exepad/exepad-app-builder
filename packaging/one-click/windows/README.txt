Exepad - one-click install (Windows)
====================================

1. Extract this ZIP somewhere (right-click the ZIP -> Extract All...).

2. Double-click "Install Exepad.bat".
   If SmartScreen shows "Windows protected your PC", click
   "More info" -> "Run anyway" (expected for unsigned downloads).

3. Docker Desktop already installed but not running? The installer starts it
   and waits - you do not have to do anything.
   Not installed at all? The installer opens its download page. Install it,
   then double-click "Install Exepad.bat" again.

4. The installer asks for the email and password you want, and creates your
   operator account for you. Your password will NOT appear as you type it -
   that is normal, keep typing and press Enter. Press Enter at the email
   prompt to skip and create the account in the browser instead.

   Answering here is worth it: until the account exists, the studio offers to
   create one to anyone who can reach this machine on your network.

5. When it finishes, the studio opens at http://localhost:8080 - just log in.

   Then set your AI provider key in the studio under Settings - the installer
   never asks for it.

Requirements
------------
- Windows 10/11 64-bit
- Docker Desktop (the installer guides you; WSL 2 may need a reboot)
- 8 GB RAM recommended (builds peak at 2-3 GB)


If you skipped the account prompt
--------------------------------
First-run setup is then left open and tokenless, so create your account
promptly - whoever reaches this machine on :8080 first can claim it.

To require a one-time setup token instead, put

  EXEPAD_ALLOW_OPEN_SETUP=0

in %USERPROFILE%\.exepad\.env and double-click "Install Exepad.bat" again -
it never overwrites a setting you put there yourself. The studio then asks
for a token, and the installer prints it as its last line.


Manage it later
---------------
Re-run "Install Exepad.bat" any time to update to this package's version.
Node 18+ users also get the operator CLI:  npx exepad-app-builder status | stop | start | update | backup

Your data lives in the Docker volume "exepad-data" - reinstalling or
updating never touches it.
