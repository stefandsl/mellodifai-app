; MellodifAI for Windows: per-user installer (no administrator rights).
; Built by apps/windows/src/build.mjs, which passes VERSION, STAGE and OUTFILE.
; Layout and behaviour: docs/windows-app.md.
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef STAGE
  !error "STAGE is required"
!endif
!ifndef OUTFILE
  !error "OUTFILE is required"
!endif

!define APP "MellodifAI"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MellodifAI"
!define APP_KEY "Software\MellodifAI"
!define NODE '"$INSTDIR\node\node.exe"'
!define RUN '"$INSTDIR\app\apps\windows\src\run.mjs"'

Name "${APP}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
InstallDir "$LOCALAPPDATA\Programs\MellodifAI"
InstallDirRegKey HKCU "${APP_KEY}" "InstallDir"
ShowInstDetails show
BrandingText "${APP} ${VERSION}"
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Installazione di ${APP}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MellodifAI"

!define MUI_ICON "${STAGE}\mellodifai.ico"
!define MUI_UNICON "${STAGE}\mellodifai.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Questo programma installa ${APP} ${VERSION} sul tuo PC.$\r$\n$\r$\nServe Docker Desktop (gratuito) gia' installato e una connessione a Internet per la prima preparazione.$\r$\n$\r$\nI tuoi dati restano su questo PC, nella cartella che scegli."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Scegli dove installare ${APP}. Serve un disco diverso da C: con almeno 20 GB liberi: qui finiscono anche canzoni, video e database."
!define MUI_FINISHPAGE_TITLE "${APP} e' pronto"
!define MUI_FINISHPAGE_TEXT "Apri ${APP} con l'icona sul desktop o dal menu Start.$\r$\n$\r$\nPer spegnerlo usa 'Ferma MellodifAI' nel menu Start."

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY
Page custom EmailPage EmailLeave
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Italian"

Var Email
Var EmailField
Var Updating
Var BestDrive
Var BestFree

; ---- choosing the folder ----

Function PickDrive
  ; $9 is a root such as "E:\". Keep the non-system fixed drive with the most free space.
  StrCpy $0 $9 2
  StrCpy $1 $WINDIR 2
  ${If} $0 != $1
    ${DriveSpace} $9 "/D=F /S=G" $2
    ${If} $2 > $BestFree
      StrCpy $BestFree $2
      StrCpy $BestDrive $0
    ${EndIf}
  ${EndIf}
  Push $0
FunctionEnd

Function .onInit
  StrCpy $Updating "0"
  ; InstallDirRegKey (an earlier install) or /D= has already set $INSTDIR otherwise.
  ${If} $INSTDIR == "$LOCALAPPDATA\Programs\MellodifAI"
    StrCpy $BestFree 0
    StrCpy $BestDrive ""
    ${GetDrives} "HDD" "PickDrive"
    ${If} $BestDrive != ""
      StrCpy $INSTDIR "$BestDrive\MellodifAI"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\data\config\owner.json"
    StrCpy $Updating "1"
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/EMAIL=" $Email
FunctionEnd

Function DirectoryLeave
  StrCpy $0 $INSTDIR 2
  StrCpy $1 $WINDIR 2
  ${If} $0 == $1
    MessageBox MB_ICONEXCLAMATION|MB_OK "${APP} non puo' stare sul disco di sistema ($1). Scegli un altro disco, per esempio E:."
    Abort
  ${EndIf}
  StrLen $2 $INSTDIR
  ${If} $2 <= 3
    MessageBox MB_ICONEXCLAMATION|MB_OK "Scegli una cartella (per esempio $0\MellodifAI), non la radice del disco."
    Abort
  ${EndIf}
  ${DriveSpace} "$0\" "/D=F /S=G" $3
  ${If} $3 < 20
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "Su $0 restano solo $3 GB liberi: ne servono almeno 20. Continuare lo stesso?" IDYES space_ok
    Abort
    space_ok:
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\data\config\owner.json"
    StrCpy $Updating "1"
  ${EndIf}
FunctionEnd

; ---- the owner's email (new installs only) ----

Function EmailPage
  ${If} $Updating == "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Il tuo account" "MellodifAI crea un account solo per te, su questo PC."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 36u "Scrivi la tua email. Serve come nome del tuo account: l'app ti fa entrare da sola quando la apri dall'icona, senza password."
  Pop $0
  ${NSD_CreateText} 0 44u 100% 13u $Email
  Pop $EmailField
  nsDialogs::Show
FunctionEnd

Function EmailLeave
  ${NSD_GetText} $EmailField $Email
  StrLen $0 $Email
  ${If} $0 < 6
    MessageBox MB_ICONEXCLAMATION|MB_OK "Scrivi un'email valida, per esempio nome@esempio.it."
    Abort
  ${EndIf}
FunctionEnd

; ---- sections ----

Section "MellodifAI" SecApp
  SectionIn RO
  SetShellVarContext current
  ; Silent installs skip the folder page, so its checks are repeated here.
  StrCpy $0 $INSTDIR 2
  StrCpy $1 $WINDIR 2
  StrLen $2 $INSTDIR
  ${If} $0 == $1
  ${OrIf} $2 <= 3
    MessageBox MB_ICONSTOP|MB_OK "Cartella non valida per ${APP}: $INSTDIR" /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  ${If} $Updating == "0"
  ${AndIf} $Email == ""
    MessageBox MB_ICONSTOP|MB_OK "Manca l'email del tuo account (/EMAIL=...)." /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\app\apps\windows\src\run.mjs"
    DetailPrint "Spengo la versione installata..."
    nsExec::ExecToLog '${NODE} ${RUN} stop'
    Pop $0
    DetailPrint "Rimuovo i file della versione precedente (i tuoi dati restano)..."
    RMDir /r "$INSTDIR\app"
  ${EndIf}
  SetOutPath "$INSTDIR"
  File "${STAGE}\mellodifai.ico"
  File "${STAGE}\THIRD-PARTY.txt"
  SetOutPath "$INSTDIR\node"
  File /r "${STAGE}\node\*.*"
  SetOutPath "$INSTDIR\pnpm"
  File /r "${STAGE}\pnpm\*.*"
  SetOutPath "$INSTDIR\app"
  File /r "${STAGE}\app\*.*"
  CreateDirectory "$INSTDIR\data"
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\Disinstalla MellodifAI.exe"
  WriteRegStr HKCU "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_KEY}" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\mellodifai.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Disinstalla MellodifAI.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Disinstalla MellodifAI.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR\app" "/S=0K" $0 $1 $2
  IntOp $0 $0 + 120000
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0

  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\MellodifAI.lnk" ${NODE} '${RUN} start' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Apri MellodifAI"
  CreateShortcut "$SMPROGRAMS\${APP}\Ferma MellodifAI.lnk" ${NODE} '${RUN} stop' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Spegni MellodifAI"
  CreateShortcut "$SMPROGRAMS\${APP}\Salva un backup.lnk" ${NODE} '${RUN} backup' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Salva database e file in data\backups"
  CreateShortcut "$SMPROGRAMS\${APP}\Ripristina un backup.lnk" ${NODE} '${RUN} restore' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Torna a un backup salvato"
  CreateShortcut "$SMPROGRAMS\${APP}\Stato di MellodifAI.lnk" ${NODE} '${RUN} status' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Cosa e' acceso"
  CreateShortcut "$SMPROGRAMS\${APP}\Le tue chiavi.lnk" "$WINDIR\notepad.exe" '"$INSTDIR\data\config\worker.env"' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Chiavi kie e OpenRouter"
  CreateShortcut "$SMPROGRAMS\${APP}\Cartella dei backup.lnk" "$WINDIR\explorer.exe" '"$INSTDIR\data\backups"' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Apri i backup"
  CreateShortcut "$SMPROGRAMS\${APP}\Disinstalla MellodifAI.lnk" "$INSTDIR\Disinstalla MellodifAI.exe" "" "$INSTDIR\mellodifai.ico" 0

  DetailPrint "Preparo MellodifAI: segui la finestra 'MellodifAI' (la prima volta 5-20 minuti)..."
  ${If} ${Silent}
    ExecWait '${NODE} ${RUN} install --email "$Email" --no-browser' $0
  ${ElseIf} $Updating == "1"
    ExecWait '${NODE} ${RUN} install' $0
  ${Else}
    ExecWait '${NODE} ${RUN} install --email "$Email"' $0
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "La preparazione non e' finita (codice $0). Riaprila dall'icona MellodifAI."
    SetErrorLevel 2
  ${EndIf}
SectionEnd

Section "Icona sul desktop" SecDesktop
  SetShellVarContext current
  CreateShortcut "$DESKTOP\MellodifAI.lnk" ${NODE} '${RUN} start' "$INSTDIR\mellodifai.ico" 0 SW_SHOWNORMAL "" "Apri MellodifAI"
SectionEnd

Section "Avvia all'accesso a Windows" SecAutostart
  SetShellVarContext current
  CreateShortcut "$SMSTARTUP\MellodifAI.lnk" ${NODE} '${RUN} autostart' "$INSTDIR\mellodifai.ico" 0 SW_SHOWMINNOACTIVE "" "Accende MellodifAI all'accesso"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "L'app, il suo motore e i componenti necessari."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Un'icona MellodifAI sul desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAutostart} "Accende MellodifAI (e Docker Desktop) quando entri in Windows, cosi' e' pronto dopo un riavvio."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---- uninstall ----

Section "Uninstall"
  SetShellVarContext current
  ${If} ${FileExists} "$INSTDIR\app\apps\windows\src\run.mjs"
    DetailPrint "Spengo MellodifAI..."
    nsExec::ExecToLog '${NODE} ${RUN} stop'
    Pop $0
  ${EndIf}
  ${GetParameters} $1
  ClearErrors
  ${GetOptions} $1 "/REMOVEDATA" $2
  ${If} ${Errors}
    StrCpy $2 "0"
    ${IfNot} ${Silent}
      MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Eliminare anche canzoni, video, backup e database di MellodifAI?$\r$\n$\r$\nScegli No per tenerli: una nuova installazione nella stessa cartella li ritrova." IDNO keep_data
      StrCpy $2 "1"
      keep_data:
    ${EndIf}
  ${Else}
    StrCpy $2 "1"
  ${EndIf}
  ${If} $2 == "1"
  ${AndIf} ${FileExists} "$INSTDIR\app\apps\windows\src\run.mjs"
    DetailPrint "Elimino i dati da Docker..."
    nsExec::ExecToLog '${NODE} ${RUN} remove-data --yes'
    Pop $0
    RMDir /r "$INSTDIR\data"
  ${EndIf}
  Delete "$DESKTOP\MellodifAI.lnk"
  Delete "$SMSTARTUP\MellodifAI.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\pnpm"
  Delete "$INSTDIR\mellodifai.ico"
  Delete "$INSTDIR\THIRD-PARTY.txt"
  Delete "$INSTDIR\Disinstalla MellodifAI.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
SectionEnd
