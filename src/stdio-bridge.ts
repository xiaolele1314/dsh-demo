import type { StdioBridgeHandle } from './types.js';

export class StdioBridge implements StdioBridgeHandle {
  private stream: NodeJS.ReadWriteStream;
  private lineHandlers: ((line: string) => void)[] = [];
  private buffer = '';
  private nextId = 1;

  constructor(stream: NodeJS.ReadWriteStream) {
    this.stream = stream;
    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const handler of this.lineHandlers) handler(line);
      }
    });
  }

  send(method: string, params: Record<string, unknown>, id?: number): void {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params };
    if (id !== undefined) msg.id = id;
    this.stream.write(JSON.stringify(msg) + '\n');
  }

  sendRequest(method: string, params: Record<string, unknown>): number {
    const id = this.nextId++;
    this.send(method, params, id);
    return id;
  }

  waitForResponse(id: number, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for response id=${id}`));
      }, timeoutMs);

      const handler = (line: string) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            cleanup();
            if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
            else resolve(msg.result);
          }
        } catch { /* skip */ }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.lineHandlers.indexOf(handler);
        if (idx >= 0) this.lineHandlers.splice(idx, 1);
      };

      this.lineHandlers.push(handler);
    });
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandlers.push(handler);
  }

  removeLine(handler: (line: string) => void): void {
    const idx = this.lineHandlers.indexOf(handler);
    if (idx >= 0) this.lineHandlers.splice(idx, 1);
  }

  close(): void {
    this.lineHandlers = [];
    try { this.stream.end(); } catch { /* ignore */ }
  }
}

export interface ChatChunkOut {
  sessionId: string;
  textDelta?: string;
  toolCall?: { toolName: string; argumentsJson: string; resultJson: string };
  finished?: { fullContent: string; promptTokens: number; completionTokens: number; stopReason: string };
  error?: { code: string; message: string };
}

export async function* bridgeChat(
  bridge: StdioBridge,
  sessionId: string,
  message: string,
): AsyncGenerator<ChatChunkOut> {
  const id = bridge.sendRequest('session/prompt', { sessionId, text: message });

  const queue: ChatChunkOut[] = [];
  let done = false;
  let resolve: (() => void) | null = null;
  let fullContent = '';

  const handler = (line: string) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id === id) return; // prompt ack, skip

      if (msg.method === 'session/event' && msg.params?.sessionId === sessionId) {
        const p = msg.params;
        if (p.type === 'content_block_delta' && p.delta?.text) {
          fullContent += p.delta.text;
          queue.push({ sessionId, textDelta: p.delta.text });
        } else if (p.type === 'tool_use') {
          queue.push({
            sessionId,
            toolCall: {
              toolName: p.name || '',
              argumentsJson: JSON.stringify(p.input || {}),
              resultJson: '{}',
            },
          });
        } else if (p.type === 'message_stop') {
          queue.push({
            sessionId,
            finished: {
              fullContent,
              promptTokens: p.usage?.prompt_tokens || 0,
              completionTokens: p.usage?.completion_tokens || 0,
              stopReason: p.stop_reason || 'end_turn',
            },
          });
          done = true;
        } else if (p.type === 'error') {
          queue.push({ sessionId, error: { code: 'AGENT_ERROR', message: p.message || 'Unknown' } });
          done = true;
        }
        resolve?.();
      }

      if (msg.method === 'session/status' && msg.params?.status === 'idle') {
        if (!done) {
          queue.push({
            sessionId,
            finished: { fullContent, promptTokens: 0, completionTokens: 0, stopReason: 'end_turn' },
          });
          done = true;
        }
        resolve?.();
      }
    } catch { /* skip */ }
  };

  bridge.onLine(handler);

  try {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (!done) {
        await new Promise<void>((r) => { resolve = r; });
      }
    }
  } finally {
    bridge.removeLine(handler);
  }
}
