Exepad - one-click install (macOS)
==================================

1. Double-click the downloaded ZIP to extract it (Safari may have done this
   already).

2. Open "Install Exepad.command". The download is not yet Apple-notarized,
   so macOS blocks the first launch - the one-time unblock depends on your
   macOS version:

   macOS 15 (Sequoia) and newer:
     Double-click it. When macOS says it "could not verify" the file,
     click Done (NOT "Move to Trash"). Then open System Settings ->
     Privacy & Security, scroll down to the '"Install Exepad.command"
     was blocked' message, click "Open Anyway" and confirm.

   macOS 13/14:
     Right-click (Control-click) the file -> Open -> Open.

   After that one approval, plain double-click works.

3. If no Docker runtime is installed yet, the installer opens the Docker
   Desktop download page (OrbStack works too). Install it, start it
   (menu-bar icon, wait for the engine), then run "Install Exepad.command"
   again.

4. The installer asks for the email and password you want, and creates your
   operator account for you. Your password will NOT appear as you type it -
   that is normal, keep typing and press Enter. Press Enter at the email
   prompt to skip and create the account in the browser instead.

   Answering here is worth it: until the account exists, the studio offers to
   create one to anyone who can reach this machine on your network.

5. When it finishes, the studio opens at http://localhost:8080 - just log in.
   Then set your AI provider key under Settings - the installer never asks
   for it.

   Skipped the prompt? Create the account promptly. To require a one-time
   setup token instead, put EXEPAD_ALLOW_OPEN_SETUP=0 in ~/.exepad/.env and
   run the installer again - it never overwrites a setting you put there
   yourself.

Requirements
------------
- macOS 13+ (Apple Silicon or Intel)
- Docker Desktop or OrbStack (the installer guides you)
- 8 GB RAM recommended (builds peak at 2-3 GB)


Manage it later
---------------
Re-run "Install Exepad.command" any time to update to this package's version.
Node 18+ users also get the operator CLI:  npx exepad-app-builder status | stop | start | update | backup

Your data lives in the Docker volume "exepad-data" - reinstalling or
updating never touches it.
