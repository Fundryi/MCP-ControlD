# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately through [GitHub Security Advisories](https://github.com/Fundryi/MCP-ControlD/security/advisories/new). Include what you found, how to reproduce it, and what an attacker could do with it. Expect a first reply within a week.

## Scope

This project is an MCP server that holds a Control D API token and calls the Control D API on your behalf. The things worth reporting are:

- Any path where the token can leak into logs, error messages, or MCP tool output
- Any input that makes the server send the token to a host other than Control D
- Any way a read tool can cause a write
- Any way to reach a Control D endpoint the tool schema was not meant to allow

Problems in the Control D API itself belong to [Control D](https://controld.com), not here.

## If your token leaks

Revoke it in the Control D dashboard and create a new one. Revoking is immediate and does not require anything from this project.

## How this project handles your tokens

- Tokens are read from the environment at startup. There is no default value, no config file, and no command-line flag for them.
- Reads and writes use separate credentials. `CONTROLD_API_TOKEN_READ` signs every GET; `CONTROLD_API_TOKEN_WRITE` signs everything else. A read tool therefore cannot mutate anything, whatever the write token is allowed to do.
- Write tools are not registered at all without a write credential, so there is nothing for a prompt to call. That credential is `CONTROLD_API_TOKEN_WRITE`, or the older `CONTROLD_API_TOKEN` combined with `CONTROLD_ENABLE_WRITES=1`.
- Both tokens are stripped from every error before it reaches your MCP client, and `authorization` header values are replaced with `[REDACTED]`.
- Requests only go to the configured API host and to `controld.com` subdomains. The client checks the hostname before attaching credentials, so no caller can send a token elsewhere. The analytics hostname is additionally built from an identifier validated against a strict pattern.
- Paths are concatenated onto the base URL rather than resolved against it, and they must start with exactly one slash. A path such as `//example.com/x` or `\\example.com/x` would otherwise resolve to another host under WHATWG URL rules and carry your token there.
- Path segments in the named tools are URL-encoded, so an identifier cannot escape into a different endpoint.
- `CONTROLD_API_BASE_URL` decides where your token is sent, so it is restricted to https, or a loopback host for local testing. Query strings and fragments are rejected. It is still a trusted-operator setting: anyone who can set your environment variables can redirect the token, so treat it the way you treat the token itself.

## About the escape hatches

`controld_request_read` and `controld_request_write` can reach any Control D path. They exist because Control D serves endpoints its documentation does not cover, and without them those endpoints are unreachable.

They validate the path and the HTTP method. They do not validate the body against the endpoint, because there is no schema to validate it against. `controld_request_write` is annotated `destructiveHint`, and like every write tool it needs a write credential.

If you want the raw write tool gone, do not configure a write credential. If you want writes but not the raw one, that is not currently separable; open an issue and say so.
