// The seam between the protocol and the product.
//
// The live Kelo server backs these calls with Postgres queries scoped to a
// workspace. That layer is Kelo's business logic and is not part of this repo,
// so the interface below is what the protocol actually depends on. Anything that
// satisfies it can be served over MCP, including the in-memory demo next door.
import { ToolError } from './protocol.js'

export interface McpContext {
  /** Every query is scoped to this. Resolved from the API key, never from the model. */
  workspaceId: string
  backend: ToolBackend
}

export interface ChaseCase {
  case_id: string
  customer_id: string
  customer: string
  amount_gbp: number
  days_overdue: number
  stage: string
  kind: 'invoice' | 'proposal'
}

export interface ToolBackend {
  weeklyNumber(workspaceId: string): Promise<{
    verified_owed_gbp: number
    estimate_at_risk_gbp: number
    open_cases: number
  }>
  chaseQueue(workspaceId: string, limit: number, sort: QueueSort): Promise<ChaseCase[]>
  customer(workspaceId: string, customerId: string): Promise<{
    name: string
    outstanding_gbp: number
    open_cases: number
    worst_days_overdue: number
    avg_payment_delay_days: number | null
    prior_chase_count: number
  } | null>
  draftChase(workspaceId: string, caseId: string): Promise<{ subject: string; body: string } | null>
  dueSoon(workspaceId: string): Promise<Array<{
    customer: string
    amount_gbp: number
    due_date: string
    days_until_due: number
    often_pays_late: boolean
  }>>
  insights(workspaceId: string): Promise<{
    overdue_total_gbp: number
    overdue_count: number
    avg_days_overdue: number
    aging: Array<{ bucket: string; count: number; total_gbp: number }>
    worst_payers: Array<{ customer: string; total_gbp: number; invoices: number }>
  }>
}

export type QueueSort = 'priority' | 'value' | 'age'

export function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n || 0)
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN
  if (Number.isNaN(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

/**
 * Escalation test, kept here because it is a judgement the product makes rather
 * than a fact it stores: deeply overdue AND already chased more than once.
 */
export function qualifiesForEscalation(daysOverdue: number, priorChaseCount: number): boolean {
  return daysOverdue >= 60 && priorChaseCount >= 2
}

/** Dispatches a named tool to the backend and shapes the result for the model. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<unknown> {
  const { workspaceId, backend } = ctx

  switch (name) {
    case 'get_weekly_number': {
      const r = await backend.weeklyNumber(workspaceId)
      return {
        ...r,
        verified_owed: gbp(r.verified_owed_gbp),
        estimate_at_risk: gbp(r.estimate_at_risk_gbp),
        note: 'Verified is real overdue invoices. Estimate is quotes and enquiries, and is less certain.',
      }
    }

    case 'get_chase_queue': {
      const limit = clampInt(args.limit, 1, 25, 5)
      const sort = (['priority', 'value', 'age'] as const).includes(args.sort as QueueSort)
        ? (args.sort as QueueSort)
        : 'priority'
      const cases = await backend.chaseQueue(workspaceId, limit, sort)
      return { count: cases.length, cases: cases.map(c => ({ ...c, amount: gbp(c.amount_gbp) })) }
    }

    case 'get_customer': {
      const customerId = String(args.customer_id ?? '')
      if (!customerId) throw new ToolError('customer_id is required')
      const c = await backend.customer(workspaceId, customerId)
      if (!c) throw new ToolError('Customer not found in this workspace')
      const escalate = qualifiesForEscalation(c.worst_days_overdue, c.prior_chase_count)
      return {
        ...c,
        outstanding: gbp(c.outstanding_gbp),
        escalation_territory: escalate,
        escalation_note: escalate
          ? 'Deeply overdue and already chased. Statutory interest and a letter before action are the next options.'
          : 'Not yet escalation territory. A normal chase is the right next step.',
      }
    }

    case 'draft_chase': {
      const caseId = String(args.case_id ?? '')
      if (!caseId) throw new ToolError('case_id is required')
      const d = await backend.draftChase(workspaceId, caseId)
      if (!d) throw new ToolError('Open case not found in this workspace')
      return {
        ...d,
        reminder: 'Review and send this from your own inbox. Kelo never sends it for you.',
      }
    }

    case 'get_due_soon': {
      const reminders = await backend.dueSoon(workspaceId)
      return {
        count: reminders.length,
        reminders: reminders.slice(0, 10).map(r => ({ ...r, amount: gbp(r.amount_gbp) })),
      }
    }

    case 'get_insights': {
      const i = await backend.insights(workspaceId)
      return {
        ...i,
        overdue_total: gbp(i.overdue_total_gbp),
        aging: i.aging.filter(a => a.count > 0).map(a => ({ ...a, total: gbp(a.total_gbp) })),
        worst_payers: i.worst_payers.map(w => ({ ...w, total: gbp(w.total_gbp) })),
      }
    }

    default:
      throw new ToolError(`Unknown tool: ${name}`)
  }
}
