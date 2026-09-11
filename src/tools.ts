// Kelo's tool surface, as exposed to a Claude user.
//
// This is the real definition list from the live server, kept here as a worked
// example of a read-and-draft-only surface. See DESIGN.md for why there is no
// send_chase, no write, and no delete.
//
// The descriptions matter more than they look. They are the only thing the model
// reads when deciding which tool to reach for, so each one says what it returns
// and, where it matters, what it will not do.
import type { ToolDef } from './protocol.js'

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'get_weekly_number',
    description:
      "The headline: what this workspace is owed right now. Verified overdue invoices, plus an estimate figure from quotes and enquiries, with the open-case count.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_chase_queue',
    description:
      'The prioritised list of who to chase first, by value and days late. Returns open cases with the customer, amount and how overdue each is.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many to return (default 5).' },
        sort: { type: 'string', enum: ['priority', 'value', 'age'], description: 'Ordering (default priority).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_customer',
    description:
      'Detail for one customer: total outstanding, overdue case count, average payment delay, and whether they are escalation territory (deeply overdue and already chased).',
    inputSchema: {
      type: 'object',
      properties: { customer_id: { type: 'string', description: 'The customer_id from get_chase_queue.' } },
      required: ['customer_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_chase',
    description:
      "Draft a chase message for one case, in the sender's own voice. Returns a subject and body to review and send from your own inbox. It never sends anything.",
    inputSchema: {
      type: 'object',
      properties: { case_id: { type: 'string', description: 'The case_id from get_chase_queue.' } },
      required: ['case_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_due_soon',
    description:
      'Invoices due in the next two weeks that are worth a friendly heads-up before they slip, ranked by how likely each client is to pay late. Getting paid on time beats chasing late.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_insights',
    description:
      'A read on the outstanding book: overdue total, average days overdue, an aging breakdown by bucket, and the worst-paying customers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const

/** Server identity returned on initialize. */
export const SERVER_INFO = { name: 'kelo', title: 'Kelo', version: '1.0.0' }

/**
 * Sent to the model on initialize. The last sentence is load-bearing: it is the
 * approve-first promise, stated to the model in the same words the product uses
 * with its users.
 */
export const INSTRUCTIONS =
  'Kelo shows what a UK service business is owed and who to chase first, and drafts each chase in the sender’s voice. All tools are read-only or return a draft; nothing is ever sent.'
