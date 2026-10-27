export class StdioBridge {
    stream;
    lineHandlers = [];
    buffer = '';
    nextId = 1;
    constructor(stream) {
        this.stream = stream;
        stream.on('data', (chunk) => {
            this.buffer += chunk.toString();
            const lines = this.buffer.split('\n');
            this.buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                for (const handler of this.lineHandlers)
                    handler(line);
            }
        });
    }
    send(method, params, id) {
        const msg = { jsonrpc: '2.0', method, params };
        if (id !== undefined)
            msg.id = id;
        this.stream.write(JSON.stringify(msg) + '\n');
    }
    sendRequest(method, params) {
        const id = this.nextId++;
        this.send(method, params, id);
        return id;
    }
    waitForResponse(id, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout waiting for response id=${id}`));
            }, timeoutMs);
            const handler = (line) => {
                try {
                    const msg = JSON.parse(line);
                    if (msg.id === id) {
                        cleanup();
                        if (msg.error)
                            reject(new Error(msg.error.message || 'RPC error'));
                        else
                            resolve(msg.result);
                    }
                }
                catch { /* skip */ }
            };
            const cleanup = () => {
                clearTimeout(timer);
                const idx = this.lineHandlers.indexOf(handler);
                if (idx >= 0)
                    this.lineHandlers.splice(idx, 1);
            };
            this.lineHandlers.push(handler);
        });
    }
    onLine(handler) {
        this.lineHandlers.push(handler);
    }
    removeLine(handler) {
        const idx = this.lineHandlers.indexOf(handler);
        if (idx >= 0)
            this.lineHandlers.splice(idx, 1);
    }
    close() {
        this.lineHandlers = [];
        try {
            this.stream.end();
        }
        catch { /* ignore */ }
    }
}
export async function* bridgeChat(bridge, sessionId, message) {
    const id = bridge.sendRequest('session/prompt', { sessionId, text: message });
    const queue = [];
    let done = false;
    let resolve = null;
    let fullContent = '';
    const handler = (line) => {
        try {
            const msg = JSON.parse(line);
            if (msg.id === id)
                return; // prompt ack, skip
            if (msg.method === 'session/event' && msg.params?.sessionId === sessionId) {
                const p = msg.params;
                if (p.type === 'content_block_delta' && p.delta?.text) {
                    fullContent += p.delta.text;
                    queue.push({ sessionId, textDelta: p.delta.text });
                }
                else if (p.type === 'tool_use') {
                    queue.push({
                        sessionId,
                        toolCall: {
                            toolName: p.name || '',
                            argumentsJson: JSON.stringify(p.input || {}),
                            resultJson: '{}',
                        },
                    });
                }
                else if (p.type === 'message_stop') {
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
                }
                else if (p.type === 'error') {
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
        }
        catch { /* skip */ }
    };
    bridge.onLine(handler);
    try {
        while (!done || queue.length > 0) {
            if (queue.length > 0) {
                yield queue.shift();
            }
            else if (!done) {
                await new Promise((r) => { resolve = r; });
            }
        }
    }
    finally {
        bridge.removeLine(handler);
    }
}
