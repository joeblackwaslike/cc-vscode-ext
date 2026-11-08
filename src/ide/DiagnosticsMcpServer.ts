/**
 * Pure JSON-RPC responder for the in-process `claude-vscode` MCP server. The
 * CLI tunnels MCP messages to us as `mcp_message` control requests; each one
 * maps to exactly one response object for `mcp_response`. Messages without an
 * id (notifications, non-MCP events like `experiment_gates`) get an empty
 * result, since the control channel always expects a reply.
 */

export const DIAGNOSTICS_SERVER_NAME = 'claude-vscode';

const SERVER_VERSION = '1.0.0';
const TOOL_NAME = 'getDiagnostics';
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

const TOOL_DESCRIPTION =
  'Get the errors, warnings and other diagnostics VS Code currently shows in its Problems panel, including those for unsaved changes in open editors. Returns a JSON array with one entry per file. Pass `uri` to check one file, or omit it to get every file VS Code currently has diagnostics for. Many language extensions only analyze open files, so a missing file or an empty list can mean the file has not been checked, not that it is clean.';
const URI_DESCRIPTION =
  'file:// URI of the one file to check. Omit to get every file VS Code currently has diagnostics for.';

export type ToolTextBlock = { type: 'text'; text: string };
export type CollectDiagnostics = (uri: string | undefined) => Promise<ToolTextBlock[]>;

type Id = string | number;

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { uri: { type: 'string', description: URI_DESCRIPTION } },
  },
  annotations: { title: 'Get diagnostics', readOnlyHint: true },
};

async function callTool(
  id: Id,
  params: Record<string, unknown>,
  collect: CollectDiagnostics,
): Promise<Record<string, unknown>> {
  if (params.name !== TOOL_NAME) {
    return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  const uri = args.uri;
  if (uri !== undefined && typeof uri !== 'string') {
    return fail(id, INVALID_PARAMS, 'uri must be a string');
  }
  try {
    return ok(id, { content: await collect(uri) });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return ok(id, { isError: true, content: [{ type: 'text', text }] });
  }
}

export async function handleMcpMessage(
  message: unknown,
  collect: CollectDiagnostics,
): Promise<Record<string, unknown>> {
  const msg = isRecord(message) ? message : {};
  const id = msg.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return { jsonrpc: '2.0', result: {}, id: 0 };
  }
  const params = isRecord(msg.params) ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: DIAGNOSTICS_SERVER_NAME, version: SERVER_VERSION },
      });
    case 'tools/list':
      return ok(id, { tools: [TOOL_DEFINITION] });
    case 'tools/call':
      return callTool(id, params, collect);
    case 'ping':
      return ok(id, {});
    default:
      return fail(id, METHOD_NOT_FOUND, `Method not found: ${String(msg.method)}`);
  }
}
