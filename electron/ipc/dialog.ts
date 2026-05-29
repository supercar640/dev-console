import { ipcMain, dialog, BrowserWindow } from 'electron'

// 네이티브 파일/폴더 선택 다이얼로그 (spec 4-5). 지금은 워크스페이스 폴더 선택만.
export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:openDirectory', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
