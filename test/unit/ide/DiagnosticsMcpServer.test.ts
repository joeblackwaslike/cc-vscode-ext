import { describe, it, expect, vi } from 'vitest';
import { handleMcpMessage, DIAGNOSTICS_SERVER_NAME } from '../../../src/ide/DiagnosticsMcpServer';

const TOOL_DESCRIPTION =
  'Get the errors, warnings and other diagnostics VS Code currently shows in its Problems panel, including those for unsaved changes in open editors. Returns a JSON array with one entry per file. Pass `uri` to check one file, or omit it to get every file VS Code currently has diagnostics for. Many language extensions only analyze open files, so a missing file or an empty list can mean the file has not been checked, not that it is clean.';
const URI_DESCRIPTION =
  'file:// URI of the one file to check. Omit to get every file VS Code currently has diagnostics for.';

const blocks = [{ type: 'text' as const, text: '[]' }];

function call(args?: unknown, name = 'getDiagnostics') {
  return {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, ...(args === undefined ? {} : { arguments: args }) },
    id: 2,
  };
}

describe('handleMcpMessage', () => {
  it('initialize echoes the client protocolVersion and advertises tools', async () => {
    const res = await handleMcpMessage(
      {
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x' } },
        jsonrpc: '2.0',
        id: 0,
      },
      vi.fn(),
    );
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: DIAGNOSTICS_SERVER_NAME, version: expect.any(String) },
      },
    });
    expect(DIAGNOSTICS_SERVER_NAME).toBe('claude-vscode');
  });

  it('tools/list returns the single tool with the verbatim description, uri schema and annotations', async () => {
    const res = await handleMcpMessage({ method: 'tools/list', jsonrpc: '2.0', id: 1 }, vi.fn());
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'getDiagnostics',
            description: TOOL_DESCRIPTION,
            inputSchema: {
              type: 'object',
              properties: { uri: { type: 'string', description: URI_DESCRIPTION } },
            },
            annotations: { title: 'Get diagnostics', readOnlyHint: true },
          },
        ],
      },
    });
  });

  it('tools/call getDiagnostics passes uri to collect and returns its blocks as content', async () => {
    const collect = vi.fn().mockResolvedValue(blocks);
    const res = await handleMcpMessage(call({ uri: 'file:///a.ts' }), collect);
    expect(collect).toHaveBeenCalledWith('file:///a.ts');
    expect(res).toEqual({ jsonrpc: '2.0', id: 2, result: { content: blocks } });
  });

  it('tools/call with no arguments passes undefined', async () => {
    const collect = vi.fn().mockResolvedValue(blocks);
    await handleMcpMessage(call(), collect);
    expect(collect).toHaveBeenCalledWith(undefined);
    await handleMcpMessage(call({}), collect);
    expect(collect).toHaveBeenLastCalledWith(undefined);
  });

  it('tools/call with a non-string uri returns error -32602', async () => {
    const collect = vi.fn();
    const res = await handleMcpMessage(call({ uri: 5 }), collect);
    expect(res).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32602 } });
    expect(collect).not.toHaveBeenCalled();
  });

  it('tools/call for another tool name returns error -32602', async () => {
    const res = await handleMcpMessage(call({}, 'other'), vi.fn());
    expect(res).toMatchObject({ id: 2, error: { code: -32602 } });
  });

  it('ping returns an empty result', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', method: 'ping', id: 7 }, vi.fn());
    expect(res).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('a message without an id (notifications/initialized, experiment_gates) returns { jsonrpc: "2.0", result: {}, id: 0 }', async () => {
    for (const method of ['notifications/initialized', 'experiment_gates']) {
      const res = await handleMcpMessage({ jsonrpc: '2.0', method, params: {} }, vi.fn());
      expect(res).toEqual({ jsonrpc: '2.0', result: {}, id: 0 });
    }
  });

  it('an unknown method with an id returns error -32601', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', method: 'resources/list', id: 4 }, vi.fn());
    expect(res).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it('a collector that throws returns a tool result with isError: true and the message, not a JSON-RPC error', async () => {
    const collect = vi.fn().mockRejectedValue(new Error('boom'));
    const res = await handleMcpMessage(call({}), collect);
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { isError: true, content: [{ type: 'text', text: 'boom' }] },
    });
  });
});
