# kelo-mcp

A small Model Context Protocol server that lets a Claude user ask what their business is owed, who to chase first, and get a chase email drafted in their own voice.

**It cannot send anything.** Every tool either reads or returns a draft. That is a product decision, not an oversight, and [DESIGN.md](DESIGN.md) explains what it costs and what it buys.

Extracted from [Kelo](https://gokelo.com), where it backs a live MCP endpoint. No SDK dependency: the JSON-RPC layer is hand-rolled, about 120 lines, and has no runtime dependencies at all.

## Try it in 30 seconds

```bash
npm install
npm run example
```

```bash
curl -s localhost:8787 -H 'authorization: Bearer demo-key' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weekly_number","arguments":{}}}'
```

```json
{
  "verified_owed": "£6,050",
  "estimate_at_risk": "£9,600",
  "open_cases": 3,
  "note": "Verified is real overdue invoices. Estimate is quotes and enquiries, and is less certain."
}
```

That runs against an in-memory demo backend. No database, no Kelo account, no API key beyond the literal string `demo-key`.

## The tools

| Tool | Returns |
|---|---|
| `get_weekly_number` | Total owed, split into verified invoices and less certain estimates |
| `get_chase_queue` | Who to chase first, sorted by priority, value or age |
| `get_customer` | One customer's outstanding total, payment history and escalation status |
| `draft_chase` | A subject and body for one case. **Returns text; never sends** |
| `get_due_soon` | Invoices due within two weeks, ranked by how likely the client is to pay late |
| `get_insights` | Overdue total, average days overdue, aging buckets, worst payers |

## Wiring it to your own data

The protocol layer knows nothing about invoices. Implement `ToolBackend` and pass it in:

```ts
import { createPostHandler, callTool, TOOL_DEFS, SERVER_INFO, INSTRUCTIONS } from 'kelo-mcp'

export const POST = createPostHandler({
  config: { serverInfo: SERVER_INFO, tools: TOOL_DEFS, instructions: INSTRUCTIONS, callTool },
  resolveKey: async token => {
    const row = await db.apiKeys.findByHash(sha256(token))
    return row && !row.revoked_at ? { workspaceId: row.workspace_id } : null
  },
  makeContext: workspaceId => ({ workspaceId, backend: myBackend }),
})
```

`createPostHandler` takes and returns Web-standard `Request`/`Response`, so it drops into Next.js route handlers, Cloudflare Workers, Deno, Bun or plain Node 18+ without adaptation.

## Layout

```
src/protocol.ts      JSON-RPC and MCP methods. No product knowledge, no dependencies.
src/tools.ts         Tool definitions: the surface a model actually sees.
src/backend.ts       The seam. Dispatch, formatting, and the ToolBackend interface.
src/demo-backend.ts  In-memory data so the thing runs out of the box.
src/http.ts          Bearer auth and the stateless POST transport.
```

The split exists so the protocol can be tested without a database. All 18 tests run in well under a second and touch nothing external.

```bash
npm test
```

## What is not here

The live Kelo server backs these tools with Postgres queries, a drafting service and a billing entitlement check. That is Kelo's business logic and it is not in this repo. What is here is the protocol layer, the transport, the tool surface, and a demo backend that satisfies the same interface.

## Notes on the protocol

Three things the spec asks for that are easy to get subtly wrong, and how this handles them:

- **Notifications get silence, not a response.** A message with no `id` returns `null` internally and is dropped. If a batch was entirely notifications, the transport answers `202` with an empty body rather than `200` and `[]`.
- **An unknown tool is a tool error, not a protocol error.** It comes back as a normal result with `isError: true` so the model can read it and pick another tool. Reserving `-32601` for genuinely unknown *methods* keeps the two failure modes distinct.
- **The client's protocol version is echoed** when it sends one, rather than forcing the server's own.

## Licence

MIT
