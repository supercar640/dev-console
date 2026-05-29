import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { sessionsApi } from '@/ipc-client'

// xterm 인스턴스 1개를 Main의 PTY 세션에 IPC로 바인딩한다.
// 언마운트 시 detach(구독 해제)만 하고 PTY는 죽이지 않는다(절대원칙 #2).
// 재마운트하면 Main에서 스크롤백을 replay받는다.
// 패턴 adapted from agent-orchestrator/packages/web/src/components/terminal/useXtermTerminal.ts (MIT)
export default function XtermPane({ sessionId }: { sessionId: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
      theme: { background: '#121110', foreground: '#f0ece8' },
      allowProposedApi: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()

    // attach 전에 먼저 구독해야 스크롤백 이벤트를 놓치지 않는다.
    const unsub = sessionsApi.onTerminalData((id, data) => {
      if (id === sessionId) term.write(data)
    })
    const inputDisposable = term.onData((data) => {
      void sessionsApi.send(sessionId, data)
    })

    const syncSize = (): void => {
      try {
        fit.fit()
        void sessionsApi.resize(sessionId, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }
    const ro = new ResizeObserver(syncSize)
    ro.observe(host)

    // attach → 스크롤백 replay + 이후 live 출력. 끝나면 현재 크기를 PTY에 맞춤.
    void sessionsApi.attachTerminal(sessionId).then(syncSize)
    term.focus()

    return () => {
      void sessionsApi.detachTerminal(sessionId) // PTY는 살려둔다
      unsub()
      inputDisposable.dispose()
      ro.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div className="terminal-host" ref={hostRef} />
}
