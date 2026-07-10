import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: object }) => Promise<unknown>>(),
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: electron.showOpenDialog },
  BrowserWindow: { fromWebContents: electron.fromWebContents }
}))

import { registerDialogHandlers } from './dialog'

describe('파일 참조 다이얼로그 IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.handle.mockReset()
    electron.showOpenDialog.mockReset()
    electron.fromWebContents.mockReset()
    electron.handle.mockImplementation((channel, handler) => electron.handlers.set(channel, handler))
    electron.fromWebContents.mockReturnValue(null)
    registerDialogHandlers()
  })

  it('파일을 복수 선택하고 선택 순서대로 경로를 반환한다', async () => {
    const filePaths = ['C:\\work\\one.ts', 'C:\\work\\two.ts']
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths })

    const result = await electron.handlers.get('files:pickForReference')?.({ sender: {} })

    expect(electron.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile', 'multiSelections'] })
    expect(result).toEqual(filePaths)
  })

  it('선택을 취소하면 빈 배열을 반환한다', async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await electron.handlers.get('files:pickForReference')?.({ sender: {} })

    expect(result).toEqual([])
  })
})
