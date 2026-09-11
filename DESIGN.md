# Design notes

## The server cannot send anything, on purpose

There is no `send_chase`. There is no tool that writes to the ledger, marks an invoice paid, or edits a customer. Six tools: five read, one drafts.

This was the first decision made about the server and everything else follows from it.

Kelo's promise to its users is that a chase goes out from the founder's own inbox, in their own words, after they have read it. That promise is the product. A chase email is not a low-stakes artefact: it goes to someone the user has a commercial relationship with and often wants to keep. Getting the tone wrong costs more than sending nothing.

An MCP server that could send would have quietly moved that decision from the user to the model. The user would have gone from approving each message to approving a capability, and the first they would hear about a badly judged chase is when the client replied to it.

So the boundary is enforced in the code rather than in the prompt. A model cannot send through this server because there is no tool that sends, not because it has been asked nicely not to. `INSTRUCTIONS` states the same promise to the model on `initialize`, and a test asserts that no tool name matches `/send|delete|pay|write|update/`. If someone adds one later, the suite fails and they have to make the decision deliberately.

**What this costs.** The obvious demo, "Claude, chase everyone who is overdue", does not work. A user still opens their inbox to send. That is a real loss of magic in a category that sells magic.

**What it buys.** The security story stays simple enough to say in one line, which matters when the integration is being reviewed by someone whose accounting data is on the other side of it. Nothing the model does here is irreversible. And the drafting stays a suggestion, which is the only honest framing for generated text going out under someone else's name.

The rule of thumb I would apply elsewhere: expose reads and drafts freely, and make anything irreversible go through a human surface. Reversibility, not risk appetite, is the line.

## The workspace comes from the key, never from the model

Every tool is scoped to a `workspaceId` resolved from the bearer token. No tool accepts a workspace argument.

A model can be talked into asking for things by whatever is in its context, including text that arrived from a customer. Tenancy cannot be a parameter it is trusted to set correctly. Putting it in the transport, before any tool runs, means a prompt-injection attempt that asks for another workspace's ledger gets that workspace's own data back, because the request was never capable of expressing the other one.

The same reasoning applies to `limit`: it is clamped to 1..25 rather than trusted, and a nonsense `sort` falls back to priority rather than erroring.

## Why the JSON-RPC is hand-rolled

The MCP surface needed here is small: `initialize`, `tools/list`, `tools/call`, `ping`, plus notifications and batching. That is roughly 120 lines with no runtime dependencies.

Taking the SDK would have meant adding a dependency and its transitive tree to a Next.js app in order to use a fraction of it, and inheriting its opinions about transport and session state. Writing it directly meant reading the spec properly, which is where the three distinctions in the README came from. Those are the kind of detail a wrapper hides until it behaves oddly in production.

This is not general advice. For a stateful server with sampling, resources and prompts, the SDK earns its place. For six read-only tools over stateless HTTP, it did not.

## The dispatcher is injected

`handleRpc` takes the tool dispatcher in its config rather than importing it. The protocol layer has no idea what a tool does.

The point is testability. Every protocol test runs against a stub in microseconds with no database, no network and no fixtures, and the tests that matter, that notifications stay silent, that a handler throw becomes `isError` rather than a 500, that an unknown method returns `-32601`, are exactly the ones that are painful to write when the protocol and the product are entangled.

It also made this extraction possible at all. The seam already existed.

## Tool descriptions are product copy

The description is the only thing a model reads when choosing a tool, so each one says what it returns and, where it matters, what it will not do. `draft_chase` ends with "It never sends anything" for the model's benefit as much as the reader's.

`get_weekly_number` splits its answer into `verified` and `estimate` with a note explaining the difference, because the underlying data genuinely differs in confidence: settled invoices are facts, quotes are guesses. Flattening those into one number would have made a better headline and a worse answer. If a tool returns a number with uncertainty in it, the uncertainty belongs in the response, not in a footnote somewhere the model will not read.
