# MCP-ControlD — Implementation Plan

Final merged plan from two independent research passes (Claude + Codex), each
grounded in the full set of docs.controld.com reference pages, then
adversarially cross-verified. Every API fact below traces to a doc page; nothing
is guessed. Researched 2026-08-07.

## 1. Goal

An MCP server that lets any MCP client (Claude Code, Claude Desktop, Codex CLI,
Cursor, anything speaking stdio MCP) fully manage a Control D account —
profiles, filters, services, custom rules, folders, endpoints (devices), known
IPs, org data — plus every diagnostic and log capability the API actually
exposes.

## 2. Verified API facts

- Base URL `https://api.controld.com`; auth `authorization: Bearer <token>`;
  tokens are **read** or **write** scoped, optionally IP-restricted
  (reference/authentication). There is **no scope-introspection endpoint** — the
  server cannot discover whether its token can write.
- **No API versioning** — docs explicitly warn breaking changes can land without
  notice (reference/get-started). Contract tests against fixtures are essential.
- Response envelope (reference/response-conventions):
  - success: `{ "body": { "<controller>": [...] }, "success": true, "message"? }`
  - error: `{ "body": [], "success": false, "error": { "message", "code" } }`,
    first 3 digits of `code` = HTTP status
  - every object has a `PK` primary key
  - deviation: several endpoints (`/users`, `/ip`, device create, org reads)
    return flat/nested objects, not `body.<controller>[]` arrays — don't assume
    the convention, unwrap `body` and pass through
  - only `200` responses are documented; no per-endpoint error catalog
  - no pagination anywhere; `/access` is a fixed "latest 50" list
- Request encoding is **not uniform**: writes use
  `application/x-www-form-urlencoded` (arrays as literal repeated `key[]`),
  except `PUT /profiles/{id}/filters` (batch) which takes **JSON**. The wrapper
  must support both.
- Rate limits: **not documented**. Retry cautiously on 429 for reads; never
  auto-retry writes.
- Org accounts: `X-Force-Org-Id: <org_id>` header lets a parent-org token act on
  a sub-organization (documented for profiles, devices, access, CSV export).
- Custom-rule semantics (reference/post_profiles-profile-id-rules):
  `do`: 0 = BLOCK, 1 = BYPASS, 2 = SPOOF, 3 = REDIRECT; `via` = spoof target
  (IP/hostname) or proxy code for redirect (`GET /proxies` lists valid codes);
  `via_v6` for AAAA spoof; `status` 0/1; folders via `group`. A rule's `PK` is
  its hostname; rules live in folders (root = folder `0` / omitted).

## 3. Endpoint inventory — 46 documented operations

Recovered from the OpenAPI fragments embedded in every reference page (the docs
sidebar is JS-rendered and hides most pages; the complete slug list was
extracted from the page payload, each page fetched as raw markdown via its
`.md` URL). Both research passes independently converged on this inventory.

### Profiles
| Method | Path | Notes |
|---|---|---|
| GET | `/profiles` | PK, name, rule/filter counts, enabled options |
| POST | `/profiles` | `name`, optional `clone_profile_id` |
| PUT | `/profiles/{profile_id}` | rename, `disable_ttl`, lock/unlock (`lock_status`, `lock_message`, `password`) |
| DELETE | `/profiles/{profile_id}` | **only orphaned profiles** (not enforced by any device) |
| GET | `/profiles/options` | option catalog (block_rfc1918, spoof_ipv6, no_dnssec, ml_filter, ttl_blck, ttl_spff, …) |
| PUT | `/profiles/{profile_id}/options/{name}` | `status` required, `value` optional |
| GET | `/profiles/{profile_id}/default` | default rule `{do, via, status}` |
| PUT | `/profiles/{profile_id}/default` | `do`, `status` required; `via` optional |

### Filters
| Method | Path | Notes |
|---|---|---|
| GET | `/profiles/{profile_id}/filters` | native filters + state |
| GET | `/profiles/{profile_id}/filters/external` | 3rd-party filters (shape undocumented) |
| PUT | `/profiles/{profile_id}/filters` | **batch**, JSON body `filters: [{filter, status}]` — covers single-filter case |
| PUT | `/profiles/{profile_id}/filters/filter/{filter}` | single filter; redundant with batch, not wrapped |

### Services
| Method | Path | Notes |
|---|---|---|
| GET | `/services/categories` | global catalog |
| GET | `/services/categories/{category}` | services in category |
| GET | `/profiles/{profile_id}/services` | per-profile service rules |
| PUT | `/profiles/{profile_id}/services/{service}` | `do`, `status` required; `via`, `via_v6` optional |

### Custom rules & folders
| Method | Path | Notes |
|---|---|---|
| GET | `/profiles/{profile_id}/groups` | list folders |
| POST | `/profiles/{profile_id}/groups` | `name`, `do`, `status` required; `via` optional |
| PUT | `/profiles/{profile_id}/groups/{folder}` | modify folder / inherited action |
| DELETE | `/profiles/{profile_id}/groups/{folder}` | **cascades to contained rules**; spec contradictorily marks body fields required — verify live |
| GET | `/profiles/{profile_id}/rules/{folder_id}` | folder `0`/omitted = root; list response nests action as `action: {do, via}` (differs from flat write body) |
| POST | `/profiles/{profile_id}/rules` | bulk: `hostnames[]`, `do`, `status` required; `via`, `via_v6`, `group` optional |
| PUT | `/profiles/{profile_id}/rules` | same fields; selects rules by hostname (PK = hostname) — confirm live before shipping |
| DELETE | `/profiles/{profile_id}/rules/{hostname}` | one rule |

### Endpoints (devices)
| Method | Path | Notes |
|---|---|---|
| GET | `/devices` | resolvers (DoH/DoT/legacy v4/v6), profile, `stats` analytics level, DDNS, status. `last_activity=1` query param retains `last_activity`/`clients` fields **scheduled for removal** — don't build on them |
| GET | `/devices/types` | type/icon catalog |
| POST | `/devices` | `name`, `client_count`, `profile_id`, `icon` required; DDNS, legacy DNS, learn_ip, restricted, remap, desc optional; returns resolver addresses |
| PUT | `/devices/{device_id}` | all fields optional incl. `stats`, `ctrld_custom_config`, `bump_tls` |
| DELETE | `/devices/{device_id}` | **breaks DNS on deployed devices** |

### Known IPs (access)
| Method | Path | Notes |
|---|---|---|
| GET | `/access?device_id=` | latest ≤50 querying IPs (shape undocumented) |
| POST | `/access` | authorize IPs: `device_id`, `ips[]` |
| DELETE | `/access` | deauthorize IPs: `device_id`, `ips[]` |

### Analytics / diagnostics
| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/levels` | analytics levels metadata (shape undocumented) |
| GET | `/analytics/endpoints` | log storage regions (shape undocumented) |
| GET | `/ip` | caller IP + handling datacenter |
| GET | `/network` | anycast POP status (shape undocumented) |
| GET | `/proxies` | redirect location codes (shape undocumented) |

### Account / billing / organizations
| Method | Path | Notes |
|---|---|---|
| GET | `/users` | account record (flat body) |
| GET | `/billing/products`, `/billing/subscriptions`, `/billing/payments` | shapes undocumented |
| GET | `/organizations/organization`, `/organizations/members`, `/organizations/sub_organizations` | documented |
| PUT | `/organizations` | modify sub-org — **target-selection semantics undocumented** (no org id in path/body); verify before shipping |
| POST | `/organizations/suborg` | `name`, `contact_email`, `twofa_req`, `stats_endpoint` required |

### DNS query log export (separate API surface — guide-documented, no OpenAPI)
`GET https://{analytics_endpoint_id}.analytics.controld.com/v2/activity-log/csv`
— Bearer auth; `startTime`/`endTime` (RFC 3339 UTC, max 1 month back),
`endpointId` filter; `X-Force-Org-Id` for sub-orgs. Returns CSV (timestamp,
endpointId, question, action, trigger, protocol, rrType, sourceIp, geo, …).
Source: docs/how-to-export-logs-to-csv. The page carries a "For Organizations
Only" note — whether personal accounts can use it needs a live check.
Requires the device to be on Full Analytics; logs retained ~1 month.

**Verified absent** (both passes agree): no REST endpoints for the dashboard
Activity Log (JSON), Statistics, org Admin Logs, or SIEM stream querying. SIEM
streaming is Fluent Bit push, org-gated alpha — not wrappable as a request/
response tool. Also confirmed absent: `/devices/users`, `/devices/routers`
(claimed in one pass, found in no doc — rejected during cross-verification).

## 4. Logs / debugging — what the server can honestly offer

1. **`controld_export_dns_query_logs`** (experimental): windowed CSV export of
   real query logs — domains, actions, triggers, source IPs. The only
   programmatic log access; ship it, marked experimental, with a byte cap and a
   short default window.
2. **Known IPs + `GET /ip`**: the standard "legacy DNS not working / IP not
   authorized" diagnosis pair.
3. **Analytics level control**: read/set per-device `stats` (0 off / 1 counts /
   2 full) so log collection can be turned on before debugging.
4. **"Why is domain X blocked?"**: config-walk over custom rules → folders →
   service rules → filters → default rule. Heuristic (precedence isn't formally
   documented) — answers cite which config object matched and, when analytics
   are on, can be confirmed against the CSV export's `trigger` column.
5. **`GET /network`**: Control D-side incident visibility.

## 5. MCP tool set

All tools are prefixed `controld_` (avoids collisions in multi-server clients).
Reads never mutate; writes are unmistakably named. Every tool carries MCP
annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) for clients
that render them; naming alone is sufficient for those that don't.
Profile/device/access/log tools accept optional `sub_org_id` → `X-Force-Org-Id`.

### Read and diagnostic tools (13) — always registered
| Tool | Endpoint(s) |
|---|---|
| `controld_list_profiles` | GET /profiles |
| `controld_get_profile_config` (`profile_id`, `section`: filters \| external_filters \| services \| folders \| rules \| default_rule; `folder_id?`) | per-section GETs |
| `controld_list_catalog` (`catalog`: profile_options \| device_types \| service_categories \| services \| proxies \| analytics_levels \| analytics_regions; `category?`) | static/metadata GETs |
| `controld_list_devices` | GET /devices |
| `controld_list_known_ips` (`device_id`) | GET /access |
| `controld_get_account` | GET /users |
| `controld_get_billing` (`view`: products \| subscriptions \| payments) | GET /billing/* |
| `controld_get_organization` (`view`: info \| members \| sub_organizations) | GET /organizations/* |
| `controld_get_request_ip` | GET /ip |
| `controld_get_network_status` | GET /network |
| `controld_export_dns_query_logs` (`analytics_endpoint_id`, `start_time`, `end_time?`, `device_id?`) — experimental; server constructs+validates the hostname (SSRF guard), caps response size | analytics CSV endpoint |
| `controld_explain_domain` (`profile_id`, `domain`) — config-walk described in §4; read-only composite | multiple GETs |

### Write tools (21) — registered only when a write credential is configured
| Tool | Endpoint |
|---|---|
| `controld_create_profile` | POST /profiles |
| `controld_update_profile` (no `password`/unlock in v1 — MCP clients transcript arguments) | PUT /profiles/{id} |
| `controld_delete_profile` (docs: orphaned only) | DELETE /profiles/{id} |
| `controld_set_profile_option` | PUT options/{name} |
| `controld_set_filters` (batch; covers single) | PUT filters |
| `controld_set_service_rule` | PUT services/{service} |
| `controld_set_default_rule` | PUT default |
| `controld_create_custom_rules` (bulk `hostnames[]`) | POST rules |
| `controld_update_custom_rules` (hold until hostname-selection confirmed live) | PUT rules |
| `controld_delete_custom_rule` | DELETE rules/{hostname} |
| `controld_create_rule_folder` / `controld_update_rule_folder` / `controld_delete_rule_folder` (delete: cascade warning; hold until body contradiction resolved) | groups CRUD |
| `controld_create_device` / `controld_update_device` / `controld_delete_device` (delete: breaks-DNS warning) | devices CRUD |
| `controld_authorize_ips` / `controld_deauthorize_ips` | POST/DELETE /access |
| `controld_create_sub_organization` (v1.1; `controld_update_organization` held — target semantics undocumented) | org writes |

### Safety model
- Writes are opt-in via `CONTROLD_ENABLE_WRITES=1` (token scope can't be
  introspected, so the server can't infer intent). A read token + writes enabled
  just yields server-side API errors — harmless.
- Deletes are separate, destructive-annotated tools requiring explicit IDs;
  tool descriptions state the documented consequences (orphan requirement,
  cascade, DNS breakage).
- Undocumented response shapes are passed through as-is (`body` unwrapped, no
  invented interfaces); only the envelope and documented fields are validated.

## 6. Architecture

```
src/
  index.ts    # bootstrap: env check, tool registration (writes gated), stdio
  client.ts   # fetch wrapper: auth, form/JSON encoding, envelope unwrap,
              # error mapping, authorization-header redaction, X-Force-Org-Id
  tools.ts    # zod schemas + handlers, read/write grouped
```

- Deps: `@modelcontextprotocol/sdk`, `zod` only. Node >=22 native fetch.
- No codegen (docs ship per-page OpenAPI fragments, not a spec), no classes, no
  per-endpoint files.
- `CONTROLD_API_TOKEN` from env only; missing ⇒ startup error naming the
  variable. Never logged, never echoed, redacted everywhere.
- Client compatibility: stdio + plain JSON Schema tool inputs
  (`additionalProperties: false`); no sampling/elicitation/resources — tools are
  the portable surface across Claude, Codex CLI, Cursor, et al.
- Distribution: npm package with `bin` → every client configures
  `npx -y <package>` + env var. README gets per-client config snippets.

## 7. Testing

- `node:test` + injected fetch; hand-written fixtures with placeholder IDs
  (CLAUDE.md table). No live-mutation tests, ever.
- Contract tests: envelope unwrap, error mapping, form vs JSON encoding,
  `hostnames[]`/`ips[]` bracket encoding, redaction, CSV hostname validation.
- Local read-only smoke script (gitignored output) once a token exists in `.env`
  — also used to resolve the "verify live" items above and to scrub real
  responses into fixtures.

## 8. Milestones

1. **Scaffold + client**: package.json, tsconfig, `client.ts` + tests; server
   with `controld_list_profiles`, `controld_get_request_ip` wired end-to-end.
2. **All read tools** incl. `controld_explain_domain`; fixtures.
3. **Write tools** + gating + annotations; live read-only smoke to resolve the
   three held items (rule update semantics, folder-delete body, CSV export on
   personal accounts).
4. **Publish**: README client configs, license, npm.

## 9. Open questions (owner)

- **License** — MIT is the default suggestion; must be picked before public.
- ~~**npm package name**~~ → `mcp-controld`; `controld-mcp` is taken on npm.
- ~~Ship `controld_update_organization` / sub-org tools at all?~~ → shipped.
  `controld_create_suborg` matches the documented contract.
  `controld_update_organization` is marked UNVERIFIED in its description: the
  docs define no identifier parameter, so target selection is an inference and
  still needs a live organization account to confirm.
- ~~Is CSV log export usable on personal accounts, or org-only?~~ → works,
  endpoint ID comes from `stats_endpoint` on `/users`.
- Default writes on or off? Plan says off (`CONTROLD_ENABLE_WRITES=1` to
  enable); flip if daily-driver convenience wins.
