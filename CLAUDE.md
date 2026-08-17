# CLAUDE.md

## What this is

An MCP server wrapping the Control D REST API. See [README.md](README.md) for scope.
Published to npm as `mcp-controld`.

## THIS REPO IS PUBLIC

**Treat every commit as already public.** Git history is forever: a secret
committed and then deleted is still in the history, and it is exposed the moment
it is pushed. There is no "clean it up later" step that works.

So, before writing anything to a tracked file:

**Never commit**

- API tokens, of any scope, in any form — including partial or "expired" ones
- Your Control D account or organization IDs
- Real profile IDs, resolver IDs, device IDs, or device names
- Real IP addresses from an account (home IP, known-IPs responses, resolver IPs)
- Real domains from anyone's block/allow lists
- MCP client config files (`claude_desktop_config.json`, `.mcp.json`) — they embed tokens
- Raw API responses captured from a live account
- Personal notes, scratch files, or TODOs about your own network

**In docs, examples, tests, and error messages, use placeholders:**

| Real thing | Use instead |
|---|---|
| token | `YOUR_API_TOKEN` |
| profile ID | `1234567890` |
| device/resolver ID | `abcdefghij` |
| IP | `203.0.113.10` (RFC 5737 / TEST-NET) |
| domain | `example.com` |

**Real values go in `CLAUDE.local.md`.** That file is gitignored and Claude Code
loads it alongside this one, so it is the correct home for account IDs, profile
IDs, device names, home IPs, personal test domains, and any maintainer-only
procedure. Read from it freely; never copy a value out of it into a tracked
file. If you learn a real account detail during a session, write it there — not
here, and not in code comments.

**Fixtures must be hand-written or scrubbed.** If you capture a real response to
understand a shape, scrub every ID, IP, domain, and name before it lands in a
tracked file. Live captures go in `fixtures/live/` (gitignored) and stay there.

**Secrets only come from the environment.** `CONTROLD_API_TOKEN_READ` and the
optional `CONTROLD_API_TOKEN_WRITE`, read at runtime (`CONTROLD_API_TOKEN` is
still accepted for older setups). Never a default value in code, never a config
file, never a CLI arg (it shows up in process lists and shell history).

**Never log or echo a token.** Not at debug level, not in a stack trace, not in
an MCP error response, not in a "check your config" message. If an error needs
to reference a token, name the variable and nothing else. Redact `authorization`
headers before logging any request.

If you are unsure whether a value is personal, it is. Use a placeholder.

## The API

- Base URL: `https://api.controld.com`
- Auth: `authorization: Bearer <token>`
- Tokens are `read` or `write` scoped and can be IP-restricted
- Docs: https://docs.controld.com/reference/get-started

Docs pages are JS-rendered, so plain fetching returns empty shells. Use
https://docs.controld.com/llms.txt for the page index, and fetch individual
`docs.controld.com/reference/<slug>` pages by the exact slug listed there.
Appending `.md` to a reference URL returns raw markdown with the full OpenAPI
fragment.

**Never guess an endpoint path, parameter name, or response shape.** Read the
doc page for it first. If the page can't be fetched, say so instead of inventing
a signature.

## Ground rules

- Write operations (anything that changes a profile, filter, rule, or endpoint)
  must be obviously named as such and must not be triggered as a side effect of
  a read tool. `controld_request_write` is the one deliberate exception: it is a
  generic escape hatch, so it is annotated destructive and gated on the write
  credential like every other write tool.
- Reads use the read token, writes use the write token. Never route a GET
  through the write credential.
- Any new path built from user input goes through `apiPath` or `segment`. Never
  hand a raw string to `client.request`, and never resolve a path with
  `new URL(path, base)` — that lets `//host` retarget the request and carry the
  token off-site.
- Anything that attaches a credential to a whole URL must check the hostname
  first. See `assertAllowedHost`.
- No tests that mutate a live account. Fixtures only.

## Decisions made

- **TypeScript + `@modelcontextprotocol/sdk`, stdio transport.**
- **Two-token auth.** `CONTROLD_API_TOKEN_READ` signs GETs,
  `CONTROLD_API_TOKEN_WRITE` signs everything else, and write tools are not
  registered without a write credential. The older single-token setup still
  works and still needs `CONTROLD_ENABLE_WRITES=1`, so upgrading never silently
  grants write access.
- **Releases are cut by hand, not from CI. Do not add a release workflow.** One
  maintainer publishing a few versions a year does not need a CI job, an npm
  token to rotate, and a tag ritual. `prepublishOnly` runs the tests and
  `prepare` rebuilds `dist/`, which covers what a release job would have
  protected. CI still runs tests on every push. The publish procedure itself is
  maintainer-only and lives in `CLAUDE.local.md`.
- **Only GET is retried.** A write can take effect before the failure reaches
  us, and a 429 carries no promise the request was rejected before it ran.

## Open questions

Design and endpoint inventory are settled — see [PLAN.md](PLAN.md).

- `controld_update_organization` is **unverified**. Control D documents the
  fields for `PUT /organizations` but no identifier parameter, so how the target
  organization is chosen is an inference. Confirming it needs a live
  organization account. The tool says so in its own description.
- `PLAN.md` items marked "verify live" that still need a write token and a
  throwaway profile: rule-update semantics and the folder-delete body.
