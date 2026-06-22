import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'node:path'
import { initDatabase, closeDatabase, getDatabase } from './db'
import { AgentStore } from './db/agent-store'
import { registerIpcHandlers } from './ipc'
import { PtyManager } from './pty/pty-manager'
import { spawn as nodePtySpawn } from './pty/node-pty'
import { ClaudeAgentManager } from './agent/agent-manager'
import { createSdkQueryFn } from './agent/sdk-query'
import { AgentNotifier } from './agent/notifier'

// Absolute principle (CLAUDE.md): Main is the real backend. PTY/session state
// lives here and must outlive renderer windows.

// PTY는 Main이 소유한다(절대원칙 #1). env는 node-pty가 요구하는 형태로 캐스팅.
const ptyManager = new PtyManager((file, args, opts) =>
  nodePtySpawn(file, args, { ...opts, env: opts.env as { [k: string]: string } })
)

// Agent 채널(M3) — Main 소유. 세션마다 실제 SDK queryFn 을 새로 만든다.
const agentManager = new ClaudeAgentManager(() => createSdkQueryFn())

// 알림(M3 UI) — Main 소유. Electron Notification + 작업표시줄 배지.
// (진짜 시스템 트레이 아이콘은 M6 트레이 상주로 이월.)
const notifier = new AgentNotifier({
  notify: ({ title, body, sessionId }) => {
    if (!Notification.isSupported()) return
    const note = new Notification({ title, body })
    note.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.focus()
      win.webContents.send('agent:focusSession', sessionId)
    })
    note.show()
  },
  setBadgeCount: (n) => {
    app.setBadgeCount(n)
  }
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: '개발 상황판',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // electron-vite sets ELECTRON_RENDERER_URL in dev (Vite dev server).
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  const agentStore = new AgentStore(getDatabase())
  registerIpcHandlers(ptyManager, agentManager, notifier, agentStore)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows/Linux: quitting on last window is fine for M1. Tray-resident mode
  // (spec 4-9) will change this later so scheduled work survives window close.
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // PTY를 먼저 정리해 node-pty conpty helper의 WER 0x800700e8를 피한다.
  ptyManager.disposeAll()
  agentManager.disposeAll()
  notifier.dispose()
  closeDatabase()
})
