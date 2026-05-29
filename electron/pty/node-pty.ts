// node-pty 바인딩을 여기 한 곳에서만 import한다. Task 1 스파이크 결과 패키지를
// 교체해야 하면 이 파일의 import 한 줄만 바꾸면 된다.
// (AO 차용 아님 — dev-console 고유 스왑 포인트.)
export { spawn } from 'node-pty'
export type { IPty } from 'node-pty'
