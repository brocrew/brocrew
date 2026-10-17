; W4.128 · After an update, BroCrew opens again on the workspace it was running.
;
; NSIS's own way back after an update starts BroCrew from its Start-menu shortcut with `--updated`
; and nothing else, which is the default workspace. For any other workspace BroCrew starts this
; installer itself, without `--force-run`, and names that workspace's folder in one argument:
; `--brobot-reopen=<folder>` (`apps/desktop/src/main/reopen-after-update.ts`). Once the files are in
; place, BroCrew is started on that folder, as the person — the call NSIS makes to start it again
; (`StartApp`, `common.nsh`) — with `--user-data-dir` and nothing else.
;
; Without that argument (a first install, an install run by hand, or an update of the default
; workspace) this does nothing; nor for a folder that is not there. electron-builder includes this
; file by its name, from the build resources.
!macro customInstall
  Push $0
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  ${GetParameters} $R0
  StrLen $R3 $R0
  StrCpy $R1 0
  StrCpy $R4 ""
  ${DoWhile} $R1 < $R3
    StrCpy $R2 $R0 16 $R1
    ${If} $R2 == "--brobot-reopen="
      ; The argument is quoted when the character before it is a quote: it then ends at the closing
      ; quote (a Windows path never holds one), else at the next space.
      StrCpy $R5 " "
      ${If} $R1 > 0
        IntOp $R6 $R1 - 1
        StrCpy $R2 $R0 1 $R6
        ${If} $R2 == '"'
          StrCpy $R5 '"'
        ${EndIf}
      ${EndIf}
      IntOp $R1 $R1 + 16
      StrCpy $R6 $R1
      ${DoWhile} $R6 < $R3
        StrCpy $R2 $R0 1 $R6
        ${If} $R2 == $R5
          ${ExitDo}
        ${EndIf}
        IntOp $R6 $R6 + 1
      ${Loop}
      IntOp $R6 $R6 - $R1
      StrCpy $R4 $R0 $R6 $R1
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
  ${Loop}
  ${If} $R4 != ""
  ${AndIf} ${FileExists} "$R4\*.*"
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" '"--user-data-dir=$R4"'
  ${EndIf}
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $0
!macroend
