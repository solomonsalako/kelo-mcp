// An in-memory ToolBackend so the server runs, and the tests pass, with no
// database and no Kelo account. The figures are invented and obviously so.
import type { ToolBackend, QueueSort, ChaseCase } from './backend.js'

const CASES: ChaseCase[] = [
  { case_id: 'c-1', customer_id: 'cu-1', customer: 'Northwind Studio', amount_gbp: 4200, days_overdue: 74, stage: 'firm', kind: 'invoice' },
  { case_id: 'c-2', customer_id: 'cu-2', customer: 'Harbour & Co', amount_gbp: 1850, days_overdue: 21, stage: 'gentle', kind: 'invoice' },
  { case_id: 'c-3', customer_id: 'cu-3', customer: 'Meridian Build', amount_gbp: 9600, days_overdue: 9, stage: 'gentle', kind: 'proposal' },
]

const CUSTOMERS: Record<string, { name: string; avg_payment_delay_days: number | null; prior_chase_count: number }> = {
  'cu-1': { name: 'Northwind Studio', avg_payment_delay_days: 31, prior_chase_count: 3 },
  'cu-2': { name: 'Harbour & Co', avg_payment_delay_days: 4, prior_chase_count: 1 },
  'cu-3': { name: 'Meridian Build', avg_payment_delay_days: null, prior_chase_count: 0 },
}

const SORTS: Record<QueueSort, (a: ChaseCase, b: ChaseCase) => number> = {
  value: (a, b) => b.amount_gbp - a.amount_gbp,
  age: (a, b) => b.days_overdue - a.days_overdue,
  priority: (a, b) => b.amount_gbp * b.days_overdue - a.amount_gbp * a.days_overdue,
}

export const demoBackend: ToolBackend = {
  async weeklyNumber() {
    const invoices = CASES.filter(c => c.kind === 'invoice')
    return {
      verified_owed_gbp: invoices.reduce((s, c) => s + c.amount_gbp, 0),
      estimate_at_risk_gbp: CASES.filter(c => c.kind !== 'invoice').reduce((s, c) => s + c.amount_gbp, 0),
      open_cases: CASES.length,
    }
  },

  async chaseQueue(_ws, limit, sort) {
    return [...CASES].sort(SORTS[sort]).slice(0, limit)
  },

  async customer(_ws, customerId) {
    const c = CUSTOMERS[customerId]
    if (!c) return null
    const open = CASES.filter(x => x.customer_id === customerId)
    return {
      name: c.name,
      outstanding_gbp: open.reduce((s, x) => s + x.amount_gbp, 0),
      open_cases: open.length,
      worst_days_overdue: open.reduce((m, x) => Math.max(m, x.days_overdue), 0),
      avg_payment_delay_days: c.avg_payment_delay_days,
      prior_chase_count: c.prior_chase_count,
    }
  },

  async draftChase(_ws, caseId) {
    const c = CASES.find(x => x.case_id === caseId)
    if (!c) return null
    return {
      subject: `Invoice reminder, ${c.customer}`,
      body: `Hi,\n\nJust a note that we still have £${c.amount_gbp.toLocaleString('en-GB')} outstanding, now ${c.days_overdue} days past due.\n\nCould you let me know when it is likely to be settled?\n\nThanks`,
    }
  },

  async dueSoon() {
    return [
      { customer: 'Harbour & Co', amount_gbp: 2300, due_date: '2026-09-24', days_until_due: 13, often_pays_late: false },
      { customer: 'Northwind Studio', amount_gbp: 1100, due_date: '2026-09-18', days_until_due: 7, often_pays_late: true },
    ]
  },

  async insights() {
    const invoices = CASES.filter(c => c.kind === 'invoice')
    return {
      overdue_total_gbp: invoices.reduce((s, c) => s + c.amount_gbp, 0),
      overdue_count: invoices.length,
      avg_days_overdue: Math.round(invoices.reduce((s, c) => s + c.days_overdue, 0) / invoices.length),
      aging: [
        { bucket: '0-30', count: 1, total_gbp: 1850 },
        { bucket: '31-60', count: 0, total_gbp: 0 },
        { bucket: '61+', count: 1, total_gbp: 4200 },
      ],
      worst_payers: [{ customer: 'Northwind Studio', total_gbp: 4200, invoices: 1 }],
    }
  },
}
