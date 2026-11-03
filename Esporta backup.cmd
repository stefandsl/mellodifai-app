@echo off
chcp 65001 >nul
title Esporta backup
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js non e' installato: installalo da nodejs.org e riprova. & pause & exit /b 1)
node "%~dp0apps\launcher\src\launcher.mjs" backup
if errorlevel 1 (echo. & echo Premi un tasto per chiudere questa finestra. & pause >nul & exit /b 1)
echo. & echo Premi un tasto per chiudere. & pause >nul
