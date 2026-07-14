// M3 증명 PoC — 공식 Agent SDK 에서 canUseTool(권한 콜백)이 실제로 발화하는지 확인.
// 직접 stream-json 파싱으로는 막혀 있던(버그 #34046) "권한 요청" 신호가 SDK 로는 잡히는지 검증.
// + 스트리밍 입력으로 다중 턴(같은 세션 맥락 유지)도 재확인.
// 격리 샌드박스(hitl/m3-poc, gitignore). 도구 Bash 요청을 일부러 DENY 한다.
import { query } from '@anthropic-ai/claude-agent-sdk';

const log = (...a) => console.log('[sdk-poc]', ...a);

// --- 수동 입력 큐: 1턴 result 를 받은 뒤에 2턴 메시지를 밀어넣어 진짜 다중턴을 만든다 ---
function makeQueue() {
  const items = [];
  const waiters = [];
  let done = false;
  return {
    push(msg) {
      if (waiters.length) waiters.shift()({ value: msg, done: false });
      else items.push(msg);
    },
    end() {
      done = true;
      while (waiters.length) waiters.shift()({ value: undefined, done: true });
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) { yield items.shift(); continue; }
        if (done) return;
        const v = await new Promise((res) => waiters.push(res));
        if (v.done) return;
        yield v.value;
      }
    },
  };
}

const userMsg = (text) => ({ type: 'user', message: { role: 'user', content: text } });

const q = makeQueue();
// Write 도구 = 항상 권한 필요(safe-command 자동허용 대상 아님) → canUseTool 강제 발화
q.push(userMsg('Use the Write tool to create a file named poc_out.txt in the current directory with the exact contents: HELLO_FROM_POC . Do not explain, just do it.'));

let canUseToolFired = 0;
const toolRequests = [];
let resultCount = 0;
const resultTexts = [];
const messageTypes = new Set();
let sawDeniedNotice = false;

const canUseTool = async (toolName, input, opts) => {
  canUseToolFired += 1;
  toolRequests.push({ toolName, input });
  log(`★ canUseTool FIRED -> tool="${toolName}" input=${JSON.stringify(input)}`);
  // 권한을 거부해서, 거부 신호가 claude 로 되돌아가는지(다음 턴 응답으로) 확인
  return { behavior: 'deny', message: 'Denied by dev-console PoC (testing the approval channel).' };
};

try {
  for await (const message of query({
    prompt: q,
    options: {
      canUseTool,
      permissionMode: 'default',
      model: 'haiku',
      settingSources: [], // 유저/프로젝트 설정(특히 defaultMode:auto) 격리 → 자동승인 차단
      // allowedTools 를 비워 Bash 가 자동승인되지 않게 → canUseTool 이 발화하도록
    },
  })) {
    const tag = message.subtype ? `${message.type}:${message.subtype}` : message.type;
    messageTypes.add(tag);

    if (message.type === 'assistant') {
      const blocks = message.message?.content ?? [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text.trim()) log(`assistant text: ${b.text.trim().slice(0, 200)}`);
        if (b.type === 'tool_use') log(`assistant tool_use: ${b.name} ${JSON.stringify(b.input).slice(0, 150)}`);
      }
    }

    if (message.type === 'result') {
      resultCount += 1;
      const rt = typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
      resultTexts.push(rt);
      if (/deni|denied|couldn'?t|could not|not allowed|permission/i.test(rt)) sawDeniedNotice = true;
      log(`RESULT #${resultCount}: ${JSON.stringify(rt).slice(0, 220)} (session ${message.session_id})`);
      if (resultCount === 1) {
        // 다중턴 확인: 방금 시도한 작업을 기억하는지
        q.push(userMsg('What filename were you just about to write? Reply with ONLY the filename, nothing else.'));
      } else {
        q.end();
      }
    }
  }
} catch (e) {
  log('QUERY ERROR:', e?.message || e);
}

console.log('\n========== SDK PROOF VERDICT ==========');
console.log('canUseTool fired       :', canUseToolFired, 'time(s)');
console.log('tool requests          :', JSON.stringify(toolRequests));
console.log('result turns           :', resultCount);
console.log('result texts           :', JSON.stringify(resultTexts));
console.log('message types seen     :', [...messageTypes].sort());
const permGate = canUseToolFired >= 1 && toolRequests.some((t) => t.toolName === 'Write');
const multiTurn = resultCount >= 2;
const contextKept = resultTexts[1] ? /poc_out\.txt/i.test(resultTexts[1]) : false;
console.log('---------------------------------------');
console.log('permission signal via canUseTool :', permGate ? 'YES ✅' : 'NO ❌');
console.log('multi-turn (2 results)           :', multiTurn ? 'YES ✅' : 'NO ❌');
console.log('context retained (turn2)         :', contextKept ? 'YES ✅' : 'NO/na');
console.log('PROOF RESULT                     :', permGate ? '✅ PASS (SDK surfaces approvals)' : '❌ FAIL');
console.log('=======================================');
process.exit(permGate ? 0 : 1);
