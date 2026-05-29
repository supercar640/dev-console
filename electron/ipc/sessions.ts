import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import type { PtyManager } from '../pty/pty-manager'
import type { StartSessionInput, SessionInfo, TerminalDataPayload } from '@shared/types'

// 터미널 뷰가 attach한 webContents 집합. live 출력은 여기로만 브로드캐스트.
export function registerSessionHandlers(ptyManager: PtyManager): void {
  const attached = new Set<WebContents>()

  ptyManager.onData((sessionId, data) => {
    const payload: TerminalDataPayload = { sessionId, data }
    for (const wc of attached) {
      if (wc.isDestroyed()) attached.delete(wc)
      else wc.send('session:terminalData', payload)
    }
  })
  ptyManager.onStatus((info: SessionInfo) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('session:statusChange', info)
    }
  })

  ipcMain.handle('sessions:start', (_e, input: StartSessionInput): SessionInfo =>
    ptyManager.start({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows
    })
  )
  ipcMain.handle('sessions:stop', (_e, { sessionId }: { sessionId: string }): void =>
    ptyManager.stop(sessionId)
  )
  ipcMain.handle('sessions:send', (_e, { sessionId, data }: { sessionId: string; data: string }): void =>
    ptyManager.send(sessionId, data)
  )
  ipcMain.handle(
    'sessions:resize',
    (_e, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }): void =>
      ptyManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('sessions:attachTerminal', (e, { sessionId }: { sessionId: string }): SessionInfo | null => {
    attached.add(e.sender)
    // 스크롤백을 이 webContents에 먼저 보낸다. 이후 live onData는 같은 채널로
    // 뒤이어 도착하므로 순서가 보장된다(렌더러는 attach 전에 구독을 등록해 둠).
    const scrollback = ptyManager.getScrollback(sessionId)
    if (scrollback.length > 0) {
      const payload: TerminalDataPayload = { sessionId, data: scrollback }
      e.sender.send('session:terminalData', payload)
    }
    return ptyManager.status(sessionId)
  })
  ipcMain.handle('sessions:detachTerminal', (e, _arg: { sessionId: string }): void => {
    attached.delete(e.sender)
  })
}
