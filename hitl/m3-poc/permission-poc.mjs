// M3 위험 PoC — claude가 "권한 요청 / 사용자 질문"을 할 때 stream-json이 내보내는 이벤트 형태 포착.
// 도구(Bash) 활성 + permission-mode default(자동승인 안 함) → claude가 셸 실행을 시도하면
// 어떤 control/permission 이벤트가 오는지 원본 JSON을 통째로 기록한다.
// 응답(승인) 프로토콜을 모르면 멈출 수 있으므로 타임아웃으로 보호.
import { spawn } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';

const CLAUDE = 'C:\\Users\\user\\.local\\bin\\claude.exe';
const RAW = 'c:\\AI_project\\testbed\\dev-console\\hitl\\m3-poc\\permission-events.jsonl';
const TIMEOUT_MS = 60_000;

writeFileSync(RAW, ''); // truncate

const args = [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--replay-user-messages',
  '--include-hook-events',
  '--permission-mode', 'default',
  '--tools', 'Bash',
  '--model', 'haiku',
];

const prompt =
  'Use the Bash tool to run exactly this shell command: echo HELLO_FROM_POC . ' +
  'Do not explain, just run it.';

const userMsg = (text) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

const KNOWN_BENIGN = new Set([
  'system:init', 'user', 'rate_limit_event',
  'system:hook_started', 'system:hook_response',
]);

const proc = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'] });
const eventTypes = new Set();
let stderrBuf = '';
let buf = '';
let gotResult = false;

const log = (...a) => console.log('[perm-poc]', ...a);

const timer = setTimeout(() => {
  log('!!! TIMEOUT (likely waiting for a permission/control response) — killing');
  proc.kill();
}, TIMEOUT_MS);

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    appendFileSync(RAW, line + '\n');
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const tag = msg.subtype ? `${msg.type}:${msg.subtype}` : msg.type;
    eventTypes.add(tag);

    // assistant tool_use blocks are interesting (shows the intent to use a tool)
    const isAssistantToolUse =
      msg.type === 'assistant' &&
      Array.isArray(msg.message?.content) &&
      msg.message.content.some((b) => b.type === 'tool_use');

    if (!KNOWN_BENIGN.has(tag) && tag !== 'assistant' && tag !== 'result:success') {
      log(`★ INTERESTING [${tag}]:`, JSON.stringify(msg).slice(0, 1200));
    }
    if (isAssistantToolUse) {
      const tu = msg.message.content.filter((b) => b.type === 'tool_use');
      log('• assistant tool_use:', JSON.stringify(tu).slice(0, 400));
    }
    if (msg.type === 'result') {
      gotResult = true;
      log('• RESULT:', JSON.stringify({
        subtype: msg.subtype,
        is_error: msg.is_error,
        result: msg.result,
        permission_denials: msg.permission_denials,
        num_turns: msg.num_turns,
      }));
      proc.stdin.end();
    }
  }
});

proc.stderr.on('data', (c) => { stderrBuf += c.toString('utf8'); });
proc.on('error', (e) => { clearTimeout(timer); log('SPAWN ERROR:', e.message); process.exit(2); });
proc.on('close', (code) => {
  clearTimeout(timer);
  console.log('\n========== PERMISSION PoC SUMMARY ==========');
  console.log('exit code        :', code);
  console.log('reached a result :', gotResult ? 'YES' : 'NO (hung / killed before turn end)');
  console.log('event types seen :', [...eventTypes].sort());
  console.log('raw saved to     :', RAW);
  if (stderrBuf.trim()) console.log('stderr (first 600):', stderrBuf.trim().slice(0, 600));
  console.log('============================================');
});

proc.stdin.write(userMsg(prompt));
