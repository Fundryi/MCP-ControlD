import { z } from "zod";

import {
  defineTool,
  nonEmptyString,
  readAnnotations,
  segment,
  subOrgInput,
  type ToolDefinition,
} from "./tools-shared.js";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_RULE_FOLDERS = 100;
const analyticsEndpointId = nonEmptyString.regex(
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  "Must be a lowercase analytics endpoint ID containing only letters, numbers, and internal hyphens.",
);
const rfc3339 = z.iso.datetime({ offset: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    throw new Error(`Unexpected Control D response: missing ${field} array.`);
  }
  return value[field];
}

function recordField(value: unknown, field: string): Record<string, unknown> {
  const fieldValue = isRecord(value) ? value[field] : undefined;
  if (!isRecord(fieldValue)) {
    throw new Error(`Unexpected Control D response: missing ${field} object.`);
  }
  return fieldValue;
}

function enabled(value: unknown): boolean {
  return isRecord(value) && (value.status === 1 || value.status === true || value.status === "1");
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export const diagnosticsTools: readonly ToolDefinition[] = [
  defineTool({
    name: "controld_export_dns_query_logs",
    config: {
      description: "Experimental: export DNS query logs as CSV. Requires Full Analytics on the device and may require an organization account.",
      inputSchema: z.object({
        analytics_endpoint_id: analyticsEndpointId.optional().describe("Analytics instance endpoint ID, not a hostname or URL. Omitted: auto-discovered from the account's stats_endpoint."),
        start_time: rfc3339.describe("RFC 3339 start timestamp."),
        end_time: rfc3339.optional().describe("Optional RFC 3339 end timestamp; omit for current logs."),
        device_id: nonEmptyString.optional().describe("Optional device/resolver ID."),
        ...subOrgInput,
      }).strict(),
      annotations: readAnnotations,
    },
    handler: async (client, {
      analytics_endpoint_id,
      start_time,
      end_time,
      device_id,
      sub_org_id,
    }) => {
      let endpointId = analytics_endpoint_id;
      if (endpointId === undefined) {
        const account = await client.request<{ stats_endpoint?: unknown }>("/users", {
          subOrgId: sub_org_id,
        });
        if (typeof account.stats_endpoint !== "string" || account.stats_endpoint === "") {
          throw new Error(
            "No analytics endpoint found on the account; pass analytics_endpoint_id explicitly.",
          );
        }
        endpointId = analyticsEndpointId.parse(account.stats_endpoint);
      }
      const url = new URL(`https://${endpointId}.analytics.controld.com/v2/activity-log/csv`);
      url.searchParams.set("startTime", start_time);
      if (end_time) url.searchParams.set("endTime", end_time);
      if (device_id) url.searchParams.set("endpointId", device_id);
      const { text, truncated } = await client.rawGet(url, {
        subOrgId: sub_org_id,
        maxBytes: MAX_CSV_BYTES,
      });
      return truncated
        ? `${text}\n\n[TRUNCATED: response exceeded ${MAX_CSV_BYTES} bytes.]`
        : text;
    },
  }),
  defineTool({
    name: "controld_explain_domain",
    config: {
      description: "Explain profile configuration relevant to a domain. This is a heuristic config walk, not a DNS resolution trace; Control D precedence is not formally documented.",
      inputSchema: z.object({
        profile_id: nonEmptyString.describe("Profile ID."),
        domain: z.string().trim().min(1).describe("Domain to inspect."),
        ...subOrgInput,
      }).strict(),
      annotations: readAnnotations,
    },
    handler: async (client, { profile_id, domain, sub_org_id }) => {
      const profilePath = `/profiles/${segment(profile_id)}`;
      const requestOptions = { subOrgId: sub_org_id };
      const groups = arrayField(
        await client.request(`${profilePath}/groups`, requestOptions),
        "groups",
      );
      const selectedGroups = groups.slice(0, MAX_RULE_FOLDERS - 1);
      // Live-verified: /rules/0 returns "No such group exists"; root rules are
      // only served at /rules with the folder segment omitted.
      const folders: Array<{ id: string | null; folder: unknown }> = [
        { id: null, folder: { PK: 0, group: "Root" } },
      ];
      for (const folder of selectedGroups) {
        if (!isRecord(folder) || (typeof folder.PK !== "string" && typeof folder.PK !== "number")) {
          throw new Error("Unexpected Control D response: invalid rule folder.");
        }
        folders.push({ id: String(folder.PK), folder });
      }

      const [ruleSets, servicesValue, filtersValue, externalFiltersValue, defaultValue] = await Promise.all([
        Promise.all(folders.map(({ id }) => client.request(
          id === null ? `${profilePath}/rules` : `${profilePath}/rules/${segment(id)}`,
          requestOptions,
        ))),
        client.request(`${profilePath}/services`, requestOptions),
        client.request(`${profilePath}/filters`, requestOptions),
        client.request(`${profilePath}/filters/external`, requestOptions),
        client.request(`${profilePath}/default`, requestOptions),
      ]);

      const inspectedDomain = normalizeDomain(domain);
      const exactCustomRules: unknown[] = [];
      const parentDomainCustomRules: unknown[] = [];
      for (const [index, ruleSet] of ruleSets.entries()) {
        const folder = folders[index].folder;
        for (const rule of arrayField(ruleSet, "rules")) {
          if (!isRecord(rule) || typeof rule.PK !== "string") {
            throw new Error("Unexpected Control D response: invalid custom rule.");
          }
          const ruleDomain = normalizeDomain(rule.PK);
          const wildcardBase = ruleDomain.startsWith("*.") ? ruleDomain.slice(2) : undefined;
          const finding = { folder, rule };
          if (ruleDomain === inspectedDomain) {
            exactCustomRules.push(finding);
          } else if (
            (wildcardBase !== undefined && (
              inspectedDomain === wildcardBase || inspectedDomain.endsWith(`.${wildcardBase}`)
            ))
            || inspectedDomain.endsWith(`.${ruleDomain}`)
          ) {
            parentDomainCustomRules.push(finding);
          }
        }
      }

      const services = arrayField(servicesValue, "services");
      const filters = arrayField(filtersValue, "filters");
      const externalFilters = arrayField(externalFiltersValue, "filters");
      const defaultRule = recordField(defaultValue, "default");

      return {
        domain: inspectedDomain,
        scope: "Configuration walk only; this is not a DNS resolution trace.",
        precedence_notice: "Findings are listed in a plausible custom-rule, service-rule, filter, default-rule order; Control D precedence is not formally documented.",
        folder_walk: {
          limit: MAX_RULE_FOLDERS,
          discovered: groups.length + 1,
          fetched: folders.length,
          truncated: groups.length > selectedGroups.length,
        },
        findings: {
          exact_custom_rules: exactCustomRules,
          parent_domain_custom_rules: parentDomainCustomRules,
          enabled_service_rules_not_domain_matched: services.filter(
            (service) => isRecord(service) && enabled(service.action),
          ),
          enabled_filters_not_domain_matched: filters.filter(enabled),
          enabled_external_filters_not_domain_matched: externalFilters.filter(enabled),
          configured_default_rule: defaultRule,
        },
        catalog_notice: "Enabled services, native filters, and external filters are listed as configured; their domain catalogs were not evaluated, so no domain match is claimed for them.",
      };
    },
  }),
] as const;
