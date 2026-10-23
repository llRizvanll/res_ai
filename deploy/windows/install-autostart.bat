@echo off
REM Adds a shortcut to start-pos.bat in this Windows user's Startup folder, so the POS starts at sign-in.
REM Also set Windows to sign in automatically and never sleep (Settings - System - Power).
set TARGET=%~dp0start-pos.bat
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Restaurant POS.lnk
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=(Split-Path $env:TARGET); $s.WindowStyle=7; $s.Save()"
echo Restaurant POS will now start automatically when you sign in to Windows.
pause
