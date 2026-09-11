// Stateless Streamable-HTTP transport, framework-agnostic (Web Request/Response).
//
// Two rules worth stating, because both are easy to get subtly wrong:
//
//  1. The workspace comes from the API key, never from the request body. A model
//     can ask for any workspace it likes; it gets the one its key resolves to.
//  2. A batch where every message was a notification produces no responses, and
//     the correct answer is 202 with an empty body, not 200 with "[]".
import { handleRpc, type JsonRpcMessage, type ServerConfig } from './protocol.js'
import type { McpContext } from './backend.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Resolves a bearer token to a workspace, or null to reject. */
export type ResolveKey = (token: string) => Promise<{ workspaceId: string } | null>

export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m?.[1]?.trim() || null
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { ...JSON_HEADERS, 'WWW-Authenticate': 'Bearer realm="MCP"' },
  })
}

export interface HandlerOptions<Ctx extends McpContext> {
  config: ServerConfig<Ctx>
  resolveKey: ResolveKey
  /** Builds the per-request context once the key has resolved to a workspace. */
  makeContext: (workspaceId: string) => Ctx
}

/** Builds a POST handler. Works in any Web-standard runtime: Next.js, Workers, Deno, Bun, Node 18+. */
export function createPostHandler<Ctx extends McpContext>(opts: HandlerOptions<Ctx>) {
  return async function POST(req: Request): Promise<Response> {
    const token = bearerFromHeader(req.headers.get('authorization'))
    if (!token) return unauthorized('Provide an API key as a Bearer token.')

    const key = await opts.resolveKey(token)
    if (!key) return unauthorized('That API key is invalid or has been revoked.')

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
        { status: 400, headers: JSON_HEADERS },
      )
    }

    const ctx = opts.makeContext(key.workspaceId)
    const isBatch = Array.isArray(body)
    const messages: JsonRpcMessage[] = isBatch ? (body as JsonRpcMessage[]) : [body as JsonRpcMessage]

    const responses: object[] = []
    for (const msg of messages) {
      const res = await handleRpc(msg, ctx, opts.config)
      if (res) responses.push(res)
    }

    if (responses.length === 0) return new Response(null, { status: 202 })
    return new Response(JSON.stringify(isBatch ? responses : responses[0]), {
      status: 200,
      headers: JSON_HEADERS,
    })
  }
}

/** Stateless Phase 1 has no server-initiated SSE stream, so GET is not supported. */
export function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Method not allowed. This endpoint uses POST (stateless JSON-RPC).' }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST' },
  })
}
