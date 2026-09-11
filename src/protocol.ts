// The MCP protocol core: hand-rolled JSON-RPC, no SDK dependency.
//
// Deliberately minimal and spec-shaped: initialize / tools/list / tools/call /
// ping, single message or batch, notifications answered with silence. Nothing in
// this file knows what a tool actually does. The dispatcher is injected, which is
// what makes the whole protocol layer testable without a database, a network, or
// a running product behind it.
//
// Extracted from Kelo (gokelo.com), where it backs a live MCP endpoint.

/** MCP revision this server speaks when the client does not name one. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface ToolDef {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: 'object'
    readonly properties?: Readonly<Record<string, unknown>>
    readonly required?: readonly string[]
    readonly additionalProperties?: boolean
  }
}

export interface ServerInfo {
  name: string
  title?: string
  version: string
}

/** Dispatches one tool call. Anything thrown is reported as a tool error, not a protocol error. */
export type CallToolFn<Ctx> = (
  name: string,
  args: Record<string, unknown>,
  ctx: Ctx,
) => Promise<unknown>

export interface ServerConfig<Ctx> {
  serverInfo: ServerInfo
  tools: readonly ToolDef[]
  callTool: CallToolFn<Ctx>
  /** Shown to the model on initialize. Say what the server is for and what it will never do. */
  instructions?: string
  protocolVersion?: string
}

function ok(id: JsonRpcMessage['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function err(id: JsonRpcMessage['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/**
 * Handle one JSON-RPC message.
 *
 * Returns null for notifications, which by spec get no response at all. Callers
 * must drop nulls rather than serialising them, and answer 202 with an empty body
 * when every message in a batch was a notification.
 */
export async function handleRpc<Ctx>(
  msg: JsonRpcMessage,
  ctx: Ctx,
  config: ServerConfig<Ctx>,
): Promise<object | null> {
  const { method, id, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion:
          (params?.protocolVersion as string) || config.protocolVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: config.serverInfo,
        ...(config.instructions ? { instructions: config.instructions } : {}),
      })

    case 'notifications/initialized':
      return null

    case 'ping':
      return isNotification ? null : ok(id, {})

    case 'tools/list':
      return ok(id, { tools: config.tools })

    case 'tools/call': {
      const name = params?.name as string
      const args = (params?.arguments as Record<string, unknown>) ?? {}

      // An unknown tool is the model's mistake, not a malformed request, so it
      // comes back as an isError tool result the model can read and recover from.
      if (!name || !config.tools.some(t => t.name === name)) {
        return ok(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true })
      }
      try {
        const result = await config.callTool(name, args, ctx)
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as object,
        })
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: (e as Error).message }], isError: true })
      }
    }

    default:
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${method}`)
  }
}

/** Raised by a tool handler to return a readable error to the model. */
export class ToolError extends Error {}
