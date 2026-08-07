import { z } from "zod";

import {
  defineTool,
  nonEmptyString,
  readAnnotations,
  segment,
  subOrgInput,
  type ToolDefinition,
} from "./tools-shared.js";

const profileConfigInput = z.object({
  profile_id: nonEmptyString,
  section: z.enum(["filters", "external_filters", "services", "folders", "rules", "default_rule"]),
  folder_id: nonEmptyString.optional().describe("Rule folder ID. Used only when section is rules; ignored otherwise."),
  ...subOrgInput,
}).strict();

const catalogInput = z.discriminatedUnion("catalog", [
  z.object({
    catalog: z.literal("services"),
    category: nonEmptyString,
  }).strict(),
  z.object({
    catalog: z.enum([
      "profile_options",
      "device_types",
      "service_categories",
      "proxies",
      "analytics_levels",
      "analytics_regions",
    ]),
  }).strict(),
]);

export const readTools: readonly ToolDefinition[] = [
  defineTool({
    name: "controld_list_profiles",
    config: {
      description: "List Control D profiles.",
      inputSchema: z.object(subOrgInput).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { sub_org_id }) => client.request("/profiles", { subOrgId: sub_org_id }),
  }),
  defineTool({
    name: "controld_get_profile_config",
    config: {
      description: "Get one configuration section for a Control D profile.",
      inputSchema: profileConfigInput,
      annotations: readAnnotations,
    },
    handler: (client, { profile_id, section, folder_id, sub_org_id }) => {
      const profilePath = `/profiles/${segment(profile_id)}`;
      const sectionPath = {
        filters: "filters",
        external_filters: "filters/external",
        services: "services",
        folders: "groups",
        rules: "rules",
        default_rule: "default",
      }[section];
      const effectiveFolderId = section === "rules" ? folder_id : undefined;
      const folderPath = effectiveFolderId !== undefined ? `/${segment(effectiveFolderId)}` : "";

      return client.request(`${profilePath}/${sectionPath}${folderPath}`, {
        subOrgId: sub_org_id,
      });
    },
  }),
  defineTool({
    name: "controld_list_catalog",
    config: {
      description: "List a Control D metadata catalog.",
      inputSchema: catalogInput,
      annotations: readAnnotations,
    },
    handler: (client, input) => {
      const path = input.catalog === "services"
        ? `/services/categories/${segment(input.category)}`
        : {
            profile_options: "/profiles/options",
            device_types: "/devices/types",
            service_categories: "/services/categories",
            proxies: "/proxies",
            analytics_levels: "/analytics/levels",
            analytics_regions: "/analytics/endpoints",
          }[input.catalog];

      return client.request(path);
    },
  }),
  defineTool({
    name: "controld_list_devices",
    config: {
      description: "List Control D devices.",
      inputSchema: z.object(subOrgInput).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { sub_org_id }) => client.request("/devices", { subOrgId: sub_org_id }),
  }),
  defineTool({
    name: "controld_list_known_ips",
    config: {
      description: "List known IP addresses for a Control D device.",
      inputSchema: z.object({ device_id: nonEmptyString, ...subOrgInput }).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { device_id, sub_org_id }) => client.request(
      `/access?${new URLSearchParams({ device_id })}`,
      { subOrgId: sub_org_id },
    ),
  }),
  defineTool({
    name: "controld_get_account",
    config: {
      description: "Get the Control D account.",
      inputSchema: z.object({}).strict(),
      annotations: readAnnotations,
    },
    handler: (client) => client.request("/users"),
  }),
  defineTool({
    name: "controld_get_billing",
    config: {
      description: "Get a Control D billing view.",
      inputSchema: z.object({ view: z.enum(["products", "subscriptions", "payments"]) }).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { view }) => client.request(`/billing/${segment(view)}`),
  }),
  defineTool({
    name: "controld_get_organization",
    config: {
      description: "Get a Control D organization view.",
      inputSchema: z.object({ view: z.enum(["info", "members", "sub_organizations"]) }).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { view }) => client.request(
      `/organizations/${segment(view === "info" ? "organization" : view)}`,
    ),
  }),
  defineTool({
    name: "controld_get_request_ip",
    config: {
      description: "Get the caller IP address and handling datacenter.",
      inputSchema: z.object({}).strict(),
      annotations: readAnnotations,
    },
    handler: (client) => client.request("/ip"),
  }),
  defineTool({
    name: "controld_get_network_status",
    config: {
      description: "Get Control D network status.",
      inputSchema: z.object({}).strict(),
      annotations: readAnnotations,
    },
    handler: (client) => client.request("/network"),
  }),
] as const;
