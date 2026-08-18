@echo off
rem Doppio clic da Esplora risorse: serve solo a lanciare rilascia.ps1
rem scavalcando il blocco sugli script, che su questa macchina e' attivo.
rem La finestra resta aperta a fine lavoro, altrimenti un errore lo si
rem leggerebbe per mezzo secondo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rilascia.ps1" %*
echo.
pause
