import { describe, it, expect } from 'vitest'
import { callTool, qualifiesForEscalation, gbp, type McpContext } from '../backend.js'
import { demoBackend } from '../demo-backend.js'
import { ToolError } from '../protocol.js'

const ctx: McpContext = { workspaceId: 'ws-1', backend: demoBackend }

describe('tool dispatch', () => {
  it('formats money as GBP with no pence', () => {
    expect(gbp(4200)).toBe('£4,200')
    expect(gbp(0)).toBe('£0')
  })

  it('clamps the chase-queue limit rather than trusting the model', async () => {
    const big = (await callTool('get_chase_queue', { limit: 9999 }, ctx)) as { count: number }
    const zero = (await callTool('get_chase_queue', { limit: 0 }, ctx)) as { count: number }
    expect(big.count).toBeLessThanOrEqual(25)
    expect(zero.count).toBeGreaterThan(0)
  })

  it('falls back to priority ordering when sort is nonsense', async () => {
    const r = (await callTool('get_chase_queue', { sort: 'dangerous' }, ctx)) as { cases: { case_id: string }[] }
    expect(r.cases.length).toBeGreaterThan(0)
  })

  it('requires customer_id and rejects an unknown customer', async () => {
    await expect(callTool('get_customer', {}, ctx)).rejects.toBeInstanceOf(ToolError)
    await expect(callTool('get_customer', { customer_id: 'nope' }, ctx)).rejects.toThrow(/not found/i)
  })

  it('always returns the approve-first reminder alongside a draft', async () => {
    const d = (await callTool('draft_chase', { case_id: 'c-1' }, ctx)) as { reminder: string; body: string }
    expect(d.reminder).toMatch(/never sends it for you/i)
    expect(d.body.length).toBeGreaterThan(0)
  })

  it('rejects an unknown tool name', async () => {
    await expect(callTool('send_chase', {}, ctx)).rejects.toThrow(/Unknown tool/)
  })
})

describe('escalation test', () => {
  it('needs both deeply overdue and already chased', () => {
    expect(qualifiesForEscalation(74, 3)).toBe(true)
    expect(qualifiesForEscalation(74, 0)).toBe(false)  // overdue but never chased
    expect(qualifiesForEscalation(10, 5)).toBe(false)  // chased but not deeply overdue
  })
})
