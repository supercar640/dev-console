import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from './db'
import { registerIpcHandlers } from './ipc'

// Absolute principle (CLAUDE.md): Main is the real backend. PTY/session state
// will live here and must outlive renderer windows. M1 only sets up the shell.

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
  registerIpcHandlers()
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
  closeDatabase()
})
