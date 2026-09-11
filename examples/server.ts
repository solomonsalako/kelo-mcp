// A runnable MCP server on the demo backend. No database, no Kelo account.
//
//   npm install && npm run example
//   curl -s localhost:8787 -H 'authorization: Bearer demo-key' \
//     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
import { createServer } from 'node:http'
import { createPostHandler, methodNotAllowed } from '../src/http.js'
import { callTool, type McpContext } from '../src/backend.js'
import { demoBackend } from '../src/demo-backend.js'
import { TOOL_DEFS, SERVER_INFO, INSTRUCTIONS } from '../src/tools.js'

const PORT = Number(process.env.PORT ?? 8787)

const handler = createPostHandler<McpContext>({
  config: { serverInfo: SERVER_INFO, tools: TOOL_DEFS, instructions: INSTRUCTIONS, callTool },
  // A real deployment hashes the token and looks it up. This demo accepts one key.
  resolveKey: async token => (token === 'demo-key' ? { workspaceId: 'demo-workspace' } : null),
  makeContext: workspaceId => ({ workspaceId, backend: demoBackend }),
})

createServer(async (req, res) => {
  if (req.method !== 'POST') {
    const r = methodNotAllowed()
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text())
    return
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const response = await handler(
    new Request(`http://localhost:${PORT}`, {
      method: 'POST',
      headers: req.headers as Record<string, string>,
      body: Buffer.concat(chunks).toString() || '{}',
    }),
  )
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(response.status === 202 ? undefined : await response.text())
}).listen(PORT, () => {
  console.log(`MCP demo server on http://localhost:${PORT}  (bearer: demo-key)`)
})
