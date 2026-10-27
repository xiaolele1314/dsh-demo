#!/usr/bin/env node
// agent-chat.js — 在容器内执行，调用 dsh 处理用户消息并流式输出 JSON lines
// 用法: node agent-chat.js --session <id> --message <text>

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const sessionIdx = args.indexOf('--session');
const messageIdx = args.indexOf('--message');
const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : 'default';
const message = messageIdx >= 0 ? args[messageIdx + 1] : '';

const provider = process.env.DSH_PROVIDER || 'deepseek';
const model = process.env.DSH_MODEL || 'deepseek-chat';
const systemPrompt = process.env.DSH_SYSTEM_PROMPT || '';
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const apiBase = process.env.DSH_API_BASE || '';

if (!message) {
  console.log(JSON.stringify({ type: 'error', code: 'INVALID_INPUT', message: 'No message provided' }));
  process.exit(1);
}

// 使用 dsh SDK 模式运行 agent
const dshArgs = [
  'npx', '@deepseek-ai/dsh', 'sdk',
  '--provider', provider,
  '--model', model,
];

if (systemPrompt) {
  dshArgs.push('--system-prompt', systemPrompt);
}

const child = spawn(dshArgs[0], dshArgs.slice(1), {
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: apiKey,
    ...(apiBase ? { DSH_API_BASE: apiBase } : {}),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

// 发送 JSON-RPC initialize
const initMsg = JSON.stringify({
  jsonrpc: '2.0',
  method: 'initialize',
  params: { cwd: '/tmp', provider, model },
  id: 1,
}) + '\n';
child.stdin.write(initMsg);

// 发送 prompt
const promptMsg = JSON.stringify({
  jsonrpc: '2.0',
  method: 'session/prompt',
  params: { sessionId, text: message },
  id: 2,
}) + '\n';

// 等 initialize 响应后发 prompt
let initialized = false;
let buffer = '';

child.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // initialize response
      if (msg.id === 1 && !initialized) {
        initialized = true;
        child.stdin.write(promptMsg);
        continue;
      }

      // session event notifications
      if (msg.method === 'session/event') {
        const event = msg.params;
        if (event.type === 'content_block_delta' && event.delta?.text) {
          console.log(JSON.stringify({ type: 'text_delta', data: event.delta.text }));
        } else if (event.type === 'tool_use') {
          console.log(JSON.stringify({
            type: 'tool_call',
            tool_name: event.name,
            arguments: JSON.stringify(event.input || {}),
          }));
        } else if (event.type === 'message_stop') {
          console.log(JSON.stringify({
            type: 'finished',
            stop_reason: event.stop_reason || 'end_turn',
            prompt_tokens: event.usage?.prompt_tokens || 0,
            completion_tokens: event.usage?.completion_tokens || 0,
          }));
        }
      }

      // session status idle = done
      if (msg.method === 'session/status' && msg.params?.status === 'idle') {
        child.stdin.end();
      }

      // prompt response
      if (msg.id === 2) {
        // prompt acknowledged
      }
    } catch {
      // non-JSON line, skip
    }
  }
});

child.on('close', () => {
  process.exit(0);
});

child.stderr.on('data', (data) => {
  // suppress stderr
});
