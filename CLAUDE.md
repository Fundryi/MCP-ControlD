# CLAUDE.md

## What this is

An MCP server wrapping the Control D REST API. See [README.md](README.md) for scope.
Implemented and tested; pre-1.0 and not yet published to npm.

## THIS REPO WILL BE PUBLISHED

It is private today and will be made public. **Treat every commit as already
public.** Git history is forever: a secret committed and then deleted is still
in the history, and making the repo public exposes the whole history at once.
There is no "clean it up before we publish" step that works.

So, before writing anything to a tracked file:

**Never commit**

- API tokens, of any scope, in any form — including partial or "expired" ones
- The owner's Control D account or organization IDs
- Real profile IDs, resolver IDs, device IDs, or device names
- Real IP addresses from the account (home IP, known-IPs responses, resolver IPs)
- Real domains from the owner's block/allow lists
- MCP client config files (`claude_desktop_config.json`, `.mcp.json`) — they embed tokens
- Raw API responses captured from a live account
- Personal notes, scratch files, TODOs about the owner's own network

**In docs, examples, tests, and error messages, use placeholders:**

| Real thing | Use instead |
|---|---|
| token | `YOUR_API_TOKEN` |
| profile ID | `1234567890` |
| device/resolver ID | `abcdefghij` |
| IP | `203.0.113.10` (RFC 5737 / TEST-NET) |
| domain | `example.com` |

**Real values go in `CLAUDE.local.md`.** That file is gitignored and Claude Code
loads it alongside this one, so it is the correct home for the owner's account
ID, profile IDs, device names, home IPs, and personal test domains. Read from it
freely; never copy a value out of it into a tracked file. If you learn a real
account detail during a session, write it there — not here, and not in code
comments.

**Fixtures must be hand-written or scrubbed.** If you capture a real response to
understand a shape, scrub every ID, IP, domain, and name before it lands in a
tracked file. Live captures go in `fixtures/live/` (gitignored) and stay there.

**Secrets only come from the environment.** `CONTROLD_API_TOKEN_READ` and the
optional `CONTROLD_API_TOKEN_WRITE`, read at runtime (`CONTROLD_API_TOKEN` is
still accepted for older setups). Never a default value in code, never a config
file, never a CLI arg (it shows up in process lists and shell history).

**Never log or echo the token.** Not at debug level, not in a stack trace, not
in an MCP error response, not in a "check your config" message. If an error
needs to reference the token, say `CONTROLD_API_TOKEN` (the variable name) and
nothing else. Redact `authorization` headers before logging any request.

If you are unsure whether a value is personal, it is. Use a placeholder.

## The API

- Base URL: `https://api.controld.com`
- Auth: `authorization: Bearer <token>`
- Tokens are `read` or `write` scoped and can be IP-restricted
- Docs: https://docs.controld.com/reference/get-started

Docs pages are JS-rendered, so plain fetching returns empty shells. Use
https://docs.controld.com/llms.txt for the page index, and fetch individual
`docs.controld.com/reference/<slug>` pages by the exact slug listed there.

**Never guess an endpoint path, parameter name, or response shape.** Read the
doc page for it first. If the page can't be fetched, say so instead of inventing
a signature.

## Ground rules

- Write operations (anything that changes a profile, filter, rule, or endpoint)
  must be obviously named as such and must not be triggered as a side effect of
  a read tool. `controld_request_write` is the one deliberate exception: it is a
  generic escape hatch, so it is annotated destructive and gated on the write
  token like every other write tool.
- Reads use the read token, writes use the write token. Never route a GET
  through the write credential.
- Any new path built from user input goes through `apiPath` or `segment`. Never
  hand a raw string to `client.request`, and never resolve a path with
  `new URL(path, base)` — that lets `//host` retarget the request.
- No tests that mutate a live account. Fixtures only.

## Decisions made

- **TypeScript + `@modelcontextprotocol/sdk`, stdio transport.** Default choice;
  say so if you'd rather have Python or a different transport.

## Open questions

Resolved 2026-08-07 — see [PLAN.md](PLAN.md) for the full design:

- ~~Full endpoint inventory~~ → 46 documented operations, inventoried in PLAN.md §3
- ~~Response envelope shape~~ → confirmed in PLAN.md §2 (with deviations noted)
- ~~Write tools in v1?~~ → yes, gated behind `CONTROLD_ENABLE_WRITES=1`

Still open:

- ~~License~~ → MIT (LICENSE file, 2026-08-07)
- ~~npm package name~~ → `mcp-controld` (2026-08-17). `controld-mcp` was taken on
  npm by an unrelated project. `private` has been removed from package.json, so
  `npm publish` will go through; do not run it without the owner asking.
- Items marked "verify live" in PLAN.md: rule-update semantics and folder-delete
  body still need a write token + throwaway profile. Resolved live 2026-08-07:
  CSV log export works on personal accounts (endpoint ID = `stats_endpoint`
  from `/users`); root rules are served at `/rules` only — `/rules/0` 404s
  despite the docs.
