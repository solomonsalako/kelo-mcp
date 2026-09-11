import { describe, it, expect } from 'vitest'
import { handleRpc, type ServerConfig } from '../protocol.js'
import { TOOL_DEFS, SERVER_INFO, INSTRUCTIONS } from '../tools.js'
import type { McpContext } from '../backend.js'
import { demoBackend } from '../demo-backend.js'

// The dispatcher is injected, so these tests never touch a database.
const ctx: McpContext = { workspaceId: 'ws-1', backend: demoBackend }

function configWith(callTool: ServerConfig<McpContext>['callTool']): ServerConfig<McpContext> {
  return { serverInfo: SERVER_INFO, tools: TOOL_DEFS, instructions: INSTRUCTIONS, callTool }
}
const config = configWith(async name => ({ echoed: name, verified_owed: '£1,000' }))

describe('MCP protocol', () => {
  it('initialize echoes the client protocol version and identifies the server', async () => {
    const res = (await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      ctx, config,
    )) as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: object } } }
    expect(res.result.protocolVersion).toBe('2025-06-18')
    expect(res.result.serverInfo.name).toBe('kelo')
    expect(res.result.capabilities.tools).toBeDefined()
  })

  it('falls back to a default protocol version when none is sent', async () => {
    const res = (await handleRpc({ id: 1, method: 'initialize', params: {} }, ctx, config)) as {
      result: { protocolVersion: string }
    }
    expect(res.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('states the approve-first promise in the instructions the model receives', async () => {
    const res = (await handleRpc({ id: 1, method: 'initialize', params: {} }, ctx, config)) as {
      result: { instructions: string }
    }
    expect(res.result.instructions).toMatch(/nothing is ever sent/i)
  })

  it('treats initialized as a notification (no response)', async () => {
    expect(await handleRpc({ method: 'notifications/initialized' }, ctx, config)).toBeNull()
  })

  it('answers ping', async () => {
    const res = (await handleRpc({ id: 2, method: 'ping' }, ctx, config)) as { result: object }
    expect(res.result).toEqual({})
  })

  it('lists exactly the defined tools', async () => {
    const res = (await handleRpc({ id: 3, method: 'tools/list' }, ctx, config)) as {
      result: { tools: { name: string }[] }
    }
    expect(res.result.tools.map(t => t.name)).toEqual([
      'get_weekly_number', 'get_chase_queue', 'get_customer', 'draft_chase', 'get_due_soon', 'get_insights',
    ])
    expect(res.result.tools).toBe(TOOL_DEFS)
  })

  it('rejects an unknown tool as a tool error, not a protocol error', async () => {
    const res = (await handleRpc(
      { id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }, ctx, config,
    )) as { result: { isError: boolean } }
    expect(res.result.isError).toBe(true)
  })

  it('routes a known tool call through the injected dispatcher and returns content + structured', async () => {
    const res = (await handleRpc(
      { id: 5, method: 'tools/call', params: { name: 'get_weekly_number', arguments: {} } }, ctx, config,
    )) as { result: { content: { type: string; text: string }[]; structuredContent: { echoed: string } } }
    expect(res.result.content[0]!.type).toBe('text')
    expect(res.result.content[0]!.text).toContain('verified_owed')
    expect(res.result.structuredContent.echoed).toBe('get_weekly_number')
  })

  it('surfaces a handler throw as an isError tool result', async () => {
    const boom = configWith(async () => { throw new Error('not found in this workspace') })
    const res = (await handleRpc(
      { id: 6, method: 'tools/call', params: { name: 'get_customer', arguments: { customer_id: 'x' } } }, ctx, boom,
    )) as { result: { isError: boolean; content: { text: string }[] } }
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0]!.text).toContain('not found')
  })

  it('returns method-not-found for an unknown request but stays silent on an unknown notification', async () => {
    const reqRes = (await handleRpc({ id: 7, method: 'frobnicate' }, ctx, config)) as { error: { code: number } }
    expect(reqRes.error.code).toBe(-32601)
    expect(await handleRpc({ method: 'frobnicate' }, ctx, config)).toBeNull()
  })
})

// Guard the exposed surface: every tool must have a name, description and object schema.
describe('MCP tool definitions', () => {
  it('are all well-formed and read/draft-only in spirit (no send/delete tools)', () => {
    for (const t of TOOL_DEFS) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe('object')
    }
    const names = TOOL_DEFS.map(t => t.name)
    expect(names.some(n => /send|delete|pay|write|update/.test(n))).toBe(false)
  })
})
