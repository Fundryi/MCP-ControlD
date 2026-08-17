# Control D MCP Server

Manage your [Control D](https://controld.com) DNS setup by talking to an AI assistant. `mcp-controld` wraps the Control D REST API as MCP tools and speaks stdio, so it works with Claude Code, Claude Desktop, Codex CLI, Cursor, and any other MCP client.

[![CI](https://github.com/Fundryi/MCP-ControlD/actions/workflows/ci.yml/badge.svg)](https://github.com/Fundryi/MCP-ControlD/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

**Status:** working, pre-1.0.

## What you can ask for

Read-only, out of the box:

- "List my Control D profiles and show which filters are on for the main one."
- "Why would `example.com` be blocked on profile 1234567890?"
- "What IPs have been talking to device `abcdefghij` lately?"
- "Is the Control D network having problems right now?"

With writes enabled:

- "Block `example.com` on my kids profile."
- "Create a rule folder called Work and put these five domains in it."
- "Turn on the malware filter for every profile."

## Requirements

- Node.js 22 or newer. Node 20 is past end of life.
- A Control D account and an API token

## Get an API token

Create a token in the Control D dashboard. Tokens are scoped **read** or **write**, and they can be locked to specific IP addresses. See the [Control D API docs](https://docs.controld.com/reference/get-started) for details.

Start with a read token. That alone is enough to run the server, and it cannot change anything. Add a separate write token later if you want the server to make changes.

## Configuration

Everything comes from environment variables, supplied by your MCP client. The server reads no config files and accepts no command-line flags for secrets, because flags show up in process lists and shell history.

| Variable | Required | What it does |
|---|---|---|
| `CONTROLD_API_TOKEN_READ` | yes | Read token. Every GET uses it. The server will not start without it. |
| `CONTROLD_API_TOKEN_WRITE` | no | Write token. Without a write credential, write tools are never registered and the server cannot change anything. |
| `CONTROLD_ORG_ID` | no | Sent as `X-Force-Org-Id` on every request. Organization accounts only. A per-call `sub_org_id` overrides it. |
| `CONTROLD_API_BASE_URL` | no | Defaults to `https://api.controld.com`. Must be https, unless it points at a loopback host for local testing. |
| `CONTROLD_API_TOKEN` | no | Older single-token setup. Still works. On its own it grants reads only. Add `CONTROLD_ENABLE_WRITES=1` to also allow writes. |

Splitting the tokens is the point: reads keep using a read-scoped credential even on a server that can write, so a read tool cannot mutate anything even if something goes wrong upstream of it.

## Setup

There is nothing to install and no setup command to run. Point your MCP client at `npx mcp-controld` and it fetches and starts the server for you.

### Claude Code

```sh
claude mcp add controld -e CONTROLD_API_TOKEN_READ=YOUR_API_TOKEN -- npx -y mcp-controld
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "controld": {
      "command": "npx",
      "args": ["-y", "mcp-controld"],
      "env": {
        "CONTROLD_API_TOKEN_READ": "YOUR_API_TOKEN"
      }
    }
  }
}
```

### Codex CLI

In `~/.codex/config.toml` or a project `.codex/config.toml`:

```toml
[mcp_servers.controld]
command = "npx"
args = ["-y", "mcp-controld"]

[mcp_servers.controld.env]
CONTROLD_API_TOKEN_READ = "YOUR_API_TOKEN"
```

### Cursor

In `mcp.json`:

```json
{
  "mcpServers": {
    "controld": {
      "command": "npx",
      "args": ["-y", "mcp-controld"],
      "env": {
        "CONTROLD_API_TOKEN_READ": "YOUR_API_TOKEN"
      }
    }
  }
}
```

Keep these config files out of version control. They contain your token.

### Running from a clone instead

If you would rather pin a local copy or you want to change the code:

```sh
git clone https://github.com/Fundryi/MCP-ControlD.git
cd MCP-ControlD
npm install
```

`npm install` builds the server for you. Then swap the command in any config above for `"command": "node"` with the absolute path to `dist/index.js` as the only argument.

## Turning on write tools

Add a write token. That is the whole switch:

```json
"env": {
  "CONTROLD_API_TOKEN_READ": "YOUR_API_TOKEN",
  "CONTROLD_API_TOKEN_WRITE": "YOUR_API_TOKEN"
}
```

With no write token the write tools do not exist. Your client cannot list them and a prompt cannot call them, so a bad prompt cannot change your DNS setup.

## Tool reference

Profile, device, access, and log tools accept an optional `sub_org_id` when you are acting on a sub-organization.

### Read tools

| Tool | Description |
|---|---|
| `controld_list_profiles` | List profiles. |
| `controld_get_profile_config` | Read filters, external filters, services, folders, rules, or the default rule for a profile. Section `all` returns every section in one call. |
| `controld_list_catalog` | List Control D metadata such as device types, services, proxies, and analytics options. |
| `controld_list_devices` | List devices. |
| `controld_get_account` | Read account information. |
| `controld_get_billing` | Read products, subscriptions, or payments. |
| `controld_get_organization` | Read organization information, members, or sub-organizations. |

### Diagnostic tools

| Tool | Description |
|---|---|
| `controld_list_known_ips` | List known IPs for a device. |
| `controld_get_request_ip` | Get the caller IP address and handling datacenter. |
| `controld_get_network_status` | Get Control D network incident status. |
| `controld_export_dns_query_logs` | Export a bounded window of DNS query logs as CSV. |
| `controld_explain_domain` | Walk a profile's rules, services, native filters, and external filters to explain how a domain is handled. |
| `controld_request_read` | Escape hatch. GET any Control D path, including undocumented ones such as `/devices/users`. |

### Write tools

Registered only when a write credential is configured: either `CONTROLD_API_TOKEN_WRITE`, or the older `CONTROLD_API_TOKEN` together with `CONTROLD_ENABLE_WRITES=1`.

| Tool | Description |
|---|---|
| `controld_create_profile` | Create a profile. |
| `controld_update_profile` | Update a profile. |
| `controld_delete_profile` | Delete an orphaned profile. |
| `controld_set_profile_option` | Set a profile option. |
| `controld_set_filters` | Set profile filters in a batch. |
| `controld_set_service_rule` | Set a service rule. |
| `controld_set_default_rule` | Set a profile's default rule. |
| `controld_create_custom_rules` | Create custom rules in bulk. |
| `controld_update_custom_rules` | Update custom rules, selected by hostname. |
| `controld_delete_custom_rule` | Delete a custom rule. |
| `controld_create_rule_folder` | Create a rule folder. |
| `controld_update_rule_folder` | Update a rule folder. |
| `controld_delete_rule_folder` | Delete a rule folder and every rule in it. |
| `controld_create_device` | Create a device. |
| `controld_update_device` | Update a device. |
| `controld_delete_device` | Delete a device, which can break its DNS resolution. |
| `controld_authorize_ips` | Authorize IP addresses. |
| `controld_deauthorize_ips` | Deauthorize IP addresses. |
| `controld_create_suborg` | Create a sub-organization. |
| `controld_update_organization` | Modify an organization's contact and policy details. |
| `controld_request_write` | Escape hatch. Send any mutating request to any Control D path. |

## Limits and caveats

`controld_export_dns_query_logs` uses Control D's CSV analytics endpoint, because there is no documented JSON REST API for dashboard query logs. It needs Full Analytics on the device, takes a bounded time window, and caps the response size. It works on personal accounts, where the analytics endpoint is discovered from the account record.

`controld_explain_domain` walks your configuration; it does not resolve DNS. Control D has not formally documented its precedence rules, so the tool reports what it matched in a plausible order and says outright which sections it could not evaluate. Treat it as a research aid, not an authoritative answer.

`controld_update_organization` covers `PUT /organizations`. Control D documents the fields but no identifier parameter, and does not say how the target organization is chosen. This tool has not been verified against a live organization account. Treat the target as unconfirmed and check what changed afterwards. If that is not acceptable, make the change in the Control D dashboard instead.

The two escape hatches, `controld_request_read` and `controld_request_write`, exist because Control D has endpoints its docs do not cover. They validate the path and nothing else. The named tools check their inputs against the documented schema; the escape hatches hand your arguments straight to the API. Reach for them last.

## Safety

- Reads and writes use separate credentials. A GET always uses the read token, so it cannot mutate anything even if the server also holds a write token.
- Write tools are not registered without a write token. There is nothing for a prompt to call.
- Delete tools have their own names, need explicit identifiers, and carry destructive MCP annotations so your client can prompt you. `controld_request_write` is annotated destructive too, because it can be.
- No read tool can trigger a write as a side effect. The server checks its own annotations at startup and refuses to run if a tool is labeled wrong.
- Tokens are read from the environment only. They are never logged, never returned in an MCP error, and authorization headers are redacted before any error text is passed on.
- Paths are host-relative and validated. A path such as `//example.com/x` cannot retarget the request at another host. The CSV export checks the hostname before attaching credentials, so the token only ever goes to Control D or to a host you configured yourself in `CONTROLD_API_BASE_URL`.
- Tool output is capped at 1 MiB, with a truncation notice, so a huge response cannot flood your client's context.
- Every request has a timeout, so a hung API call cannot stall your session. Only GET is ever retried. A write is never replayed, because a failure can arrive after the change already took effect.
- Releases are cut by hand from a clean tree. `npm publish` runs the test suite first and refuses to ship if anything fails.

Found a security problem? See [SECURITY.md](SECURITY.md).

## Troubleshooting

**`CONTROLD_API_TOKEN_READ (or CONTROLD_API_TOKEN) is required.`** The server started without a token. Check that your client config sets it in the `env` block, not in your shell.

**Write tools are missing.** Set `CONTROLD_API_TOKEN_WRITE` and restart your MCP client. Clients cache the tool list from startup, so a restart is required. On the older single-token setup, set `CONTROLD_ENABLE_WRITES=1` instead.

**A write fails with a permission error.** The token in `CONTROLD_API_TOKEN_WRITE` is read-scoped. The server cannot tell the two apart, so Control D rejects it at request time instead. Create a write token in the dashboard.

**Organization tools return an error.** Personal accounts have no organization. Those endpoints only work on org accounts.

## Development

```sh
npm test          # run the test suite
npm run build     # compile to dist/
```

Tests use fixtures and a stubbed `fetch`. Nothing in the suite touches a live account.

### Releasing

Releases go out from a maintainer's machine, not from CI. Push everything first, then:

```sh
npm version patch          # or minor / major. Commits and tags.
npm publish                # runs the tests, rebuilds dist/, then uploads
git push --follow-tags
```

`npm publish` will not ship if the tests fail, because `prepublishOnly` runs them. It rebuilds `dist/` from source on the way out, so a stale build cannot be published.

## License

[MIT](LICENSE)
