import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { PtyManager } from './pty/pty-manager'
import { spawn as nodePtySpawn } from './pty/node-pty'

// Absolute principle (CLAUDE.md): Main is the real backend. PTY/session state
// lives here and must outlive renderer windows.

// PTY는 Main이 소유한다(절대원칙 #1). env는 node-pty가 요구하는 형태로 캐스팅.
const ptyManager = new PtyManager((file, args, opts) =>
  nodePtySpawn(file, args, { ...opts, env: opts.env as { [k: string]: string } })
)

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
  registerIpcHandlers(ptyManager)
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
  closeDatabase()
})
