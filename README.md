# Control D MCP Server

`controld-mcp` exposes the Control D REST API as MCP tools over stdio.

**Status:** Working, pre-1.0, and not yet published to npm.

## Quick start

```sh
npm install
npm run build
```

Until the package is published, run the built entry point with Node. Replace the example path with the absolute path to this repository. Once published, these configurations can use `npx controld-mcp` instead.

### Claude Code

```sh
claude mcp add controld -e CONTROLD_API_TOKEN=YOUR_API_TOKEN -- node "C:/path/to/MCP-ControlD/dist/index.js"
```

### Claude Desktop

Add this server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "controld": {
      "command": "node",
      "args": ["C:/path/to/MCP-ControlD/dist/index.js"],
      "env": {
        "CONTROLD_API_TOKEN": "YOUR_API_TOKEN"
      }
    }
  }
}
```

### Codex CLI

Add this server to `~/.codex/config.toml` or a project `.codex/config.toml`:

```toml
[mcp_servers.controld]
command = "node"
args = ["C:/path/to/MCP-ControlD/dist/index.js"]

[mcp_servers.controld.env]
CONTROLD_API_TOKEN = "YOUR_API_TOKEN"
```

### Cursor

Add this server to `mcp.json`:

```json
{
  "mcpServers": {
    "controld": {
      "command": "node",
      "args": ["C:/path/to/MCP-ControlD/dist/index.js"],
      "env": {
        "CONTROLD_API_TOKEN": "YOUR_API_TOKEN"
      }
    }
  }
}
```

## Tool reference

All tools accept documented Control D identifiers. Profile, device, access, and log tools also accept optional `sub_org_id` where applicable.

### Read tools

| Tool | Description |
|---|---|
| `controld_list_profiles` | List profiles. |
| `controld_get_profile_config` | Read filters, external filters, services, folders, rules, or the default rule for a profile. |
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
| `controld_export_dns_query_logs` | Experimentally export a bounded window of DNS query logs as CSV. |
| `controld_explain_domain` | Heuristically explain how a profile's rules, services, native filters, and external filters handle a domain. |

### Write tools

These tools are registered only when `CONTROLD_ENABLE_WRITES=1`.

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
| `controld_delete_custom_rule` | Delete a custom rule. |
| `controld_create_rule_folder` | Create a rule folder. |
| `controld_update_rule_folder` | Update a rule folder. |
| `controld_create_device` | Create a device. |
| `controld_update_device` | Update a device. |
| `controld_delete_device` | Delete a device, which can break its DNS resolution. |
| `controld_authorize_ips` | Authorize IP addresses. |
| `controld_deauthorize_ips` | Deauthorize IP addresses. |

Not yet implemented (their documented API semantics are ambiguous and need live
verification): custom-rule updates, rule-folder deletion, and organization
management writes.

## Logging and debugging

Control D does not document a JSON REST API for dashboard query logs. `controld_export_dns_query_logs` uses the separate CSV analytics endpoint and is experimental: it requires Full Analytics, has bounded time and response sizes, and may be organization-only. Personal-account availability still needs live verification.

Other diagnostics cover known-IP authorization, the caller IP, Control D network status, and a heuristic walk through profile configuration. The domain explanation reflects matched configuration; Control D does not formally document its full precedence.

## Safety

- Control D API tokens are read- or write-scoped. Prefer a read token unless mutations are required.
- Write tools require both a write-scoped token and `CONTROLD_ENABLE_WRITES=1`; write tools are absent by default.
- Delete tools are separately named, require explicit identifiers, and carry destructive MCP annotations.
- `CONTROLD_API_TOKEN` is read only from the environment. Authorization headers are redacted, and the token is never logged or returned in an MCP error.

## License

[MIT](LICENSE)
