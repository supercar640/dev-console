// M3 검증 게이트 PoC — claude stream-json 다중 턴 인터랙티브 제어 확인
// 합격 기준: 한 세션을 유지한 채 stdin으로 후속 메시지를 주입 → 응답 수신을 반복하고,
//            2턴째 응답이 1턴째 맥락("42")을 기억하면 PASS.
// 로컬 검증용(hitl/ 은 gitignore). 도구 비활성화 + haiku 로 비용 최소화.
import { spawn } from 'node:child_process';

const CLAUDE = 'C:\\Users\\user\\.local\\bin\\claude.exe';
const OVERALL_TIMEOUT_MS = 120_000;

const args = [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--replay-user-messages',
  '--tools', '',
  '--model', 'haiku',
];

const turns = [
  'My lucky number is 42. Please just acknowledge in a few words — do not repeat the number.',
  'What lucky number did I tell you a moment ago? Reply with ONLY the number, nothing else.',
];

const userMsg = (text) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

const proc = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'] });

const eventTypes = new Set();
const sessionIds = new Set();
const results = [];
const parseErrors = [];
let stderrBuf = '';
let currentTurn = 0;
let buf = '';

const log = (...a) => console.log('[poc]', ...a);

const sendTurn = (i) => {
  log(`>>> SEND turn ${i + 1}: ${turns[i]}`);
  proc.stdin.write(userMsg(turns[i]));
};

const timer = setTimeout(() => {
  log('!!! OVERALL TIMEOUT — killing claude');
  proc.kill();
}, OVERALL_TIMEOUT_MS);

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      parseErrors.push(line.slice(0, 200));
      continue;
    }
    const t = msg.type;
    eventTypes.add(msg.subtype ? `${t}:${msg.subtype}` : t);
    if (msg.session_id) sessionIds.add(msg.session_id);

    if (t === 'result') {
      results[currentTurn] = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
      log(`<<< RESULT turn ${currentTurn + 1}: ${JSON.stringify(results[currentTurn])} (session ${msg.session_id})`);
      currentTurn += 1;
      if (currentTurn < turns.length) {
        sendTurn(currentTurn);
      } else {
        log('--- all turns done, closing stdin');
        proc.stdin.end();
      }
    }
  }
});

proc.stderr.on('data', (c) => { stderrBuf += c.toString('utf8'); });

proc.on('error', (e) => {
  clearTimeout(timer);
  log('SPAWN ERROR:', e.message);
  process.exit(2);
});

proc.on('close', (code) => {
  clearTimeout(timer);
  console.log('\n========== PoC VERDICT ==========');
  console.log('exit code           :', code);
  console.log('turns completed     :', results.length, '/', turns.length);
  console.log('distinct sessionIds :', [...sessionIds]);
  console.log('event types seen    :', [...eventTypes].sort());
  console.log('turn1 result        :', JSON.stringify(results[0]));
  console.log('turn2 result        :', JSON.stringify(results[1]));
  if (parseErrors.length) console.log('parse errors        :', parseErrors.length, parseErrors.slice(0, 3));
  if (stderrBuf.trim()) console.log('stderr (first 500)  :', stderrBuf.trim().slice(0, 500));

  const multiTurn = results.length >= 2;
  const oneSession = sessionIds.size === 1;
  const contextKept = !!results[1] && /\b42\b/.test(results[1]);
  const pass = multiTurn && oneSession && contextKept;
  console.log('---------------------------------');
  console.log('multi-turn (2 responses)    :', multiTurn ? 'YES' : 'NO');
  console.log('single continuous session   :', oneSession ? 'YES' : 'NO');
  console.log('context retained (saw "42") :', contextKept ? 'YES' : 'NO');
  console.log('GATE RESULT                 :', pass ? '✅ PASS' : '❌ FAIL');
  console.log('=================================');
  process.exit(pass ? 0 : 1);
});

// kick off turn 1
sendTurn(0);
