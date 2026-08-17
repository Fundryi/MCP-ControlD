import { z } from "zod";

import {
  apiPath,
  defineTool,
  nonEmptyString,
  queryInput,
  readAnnotations,
  segment,
  subOrgInput,
  withQuery,
  type ToolDefinition,
} from "./tools-shared.js";

const profileSectionPaths = {
  filters: "filters",
  external_filters: "filters/external",
  services: "services",
  folders: "groups",
  rules: "rules",
  default_rule: "default",
} as const;

type ProfileSection = keyof typeof profileSectionPaths;

const profileConfigInput = z.object({
  profile_id: nonEmptyString,
  section: z.enum([
    "filters",
    "external_filters",
    "services",
    "folders",
    "rules",
    "default_rule",
    "all",
  ]).describe("Configuration section to read, or 'all' to fetch every section in one call."),
  folder_id: nonEmptyString.optional().describe("Rule folder ID. Used only when section is rules; omit or pass 0 for the root folder."),
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
      description: "Get one configuration section for a Control D profile, or every section at once with section 'all'.",
      inputSchema: profileConfigInput,
      annotations: readAnnotations,
    },
    handler: async (client, { profile_id, section, folder_id, sub_org_id }) => {
      const profilePath = `/profiles/${segment(profile_id)}`;
      const options = { subOrgId: sub_org_id };
      const read = (name: ProfileSection, folder?: string) => {
        // Live-verified: /rules/0 404s; the root folder is addressed by omitting
        // the segment entirely.
        const effectiveFolder = name === "rules" && folder !== "0" ? folder : undefined;
        const folderPath = effectiveFolder !== undefined ? `/${segment(effectiveFolder)}` : "";
        return client.request(`${profilePath}/${profileSectionPaths[name]}${folderPath}`, options);
      };

      if (section !== "all") return read(section as ProfileSection, folder_id);

      const names = Object.keys(profileSectionPaths) as ProfileSection[];
      const results = await Promise.all(names.map((name) => read(name, folder_id)));
      return {
        note: "'rules' covers the requested folder only, root by default. Use controld_explain_domain to walk every folder.",
        ...Object.fromEntries(names.map((name, index) => [name, results[index]])),
      };
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
  defineTool({
    name: "controld_request_read",
    config: {
      description: "Escape hatch: GET any Control D API path with the read token. Use only when no typed tool covers what you need, for example the undocumented '/devices/users' and '/devices/routers'. Cannot modify anything.",
      inputSchema: z.object({
        path: apiPath,
        query: queryInput,
        ...subOrgInput,
      }).strict(),
      annotations: readAnnotations,
    },
    handler: (client, { path, query, sub_org_id }) => client.request(
      withQuery(path, query),
      { subOrgId: sub_org_id },
    ),
  }),
] as const;
