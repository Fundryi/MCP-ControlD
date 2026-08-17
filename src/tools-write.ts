import { z } from "zod";

import {
  apiPath,
  defineTool,
  destructiveAnnotations,
  nonEmptyString,
  segment,
  subOrgInput,
  writeAnnotations,
  type ToolDefinition,
} from "./tools-shared.js";

const integer = z.number().int();
const doCode = integer.min(0).max(3).describe("Rule action: 0 block, 1 bypass, 2 spoof, 3 redirect.");
const binaryStatus = z.union([z.literal(0), z.literal(1)]);

const formScalar = z.union([z.string(), z.number(), z.boolean()]);
const rawFormBody = z.record(z.string().min(1), z.union([formScalar, z.array(formScalar)]));

// Documented at PUT /organizations and POST /organizations/suborg. Both take the
// same field set; only the required list differs.
const organizationInput = {
  contact_email: nonEmptyString.describe("Primary contact email for the organization."),
  twofa_req: binaryStatus.describe("Require 2FA for members: 0 no, 1 yes."),
  stats_endpoint: nonEmptyString.describe("Storage region PK. See controld_list_catalog with catalog 'analytics_regions'."),
  address: z.string().optional().describe("Physical address."),
  website: z.string().optional().describe("Website URL."),
  contact_name: z.string().optional().describe("Name of the responsible contact."),
  contact_phone: z.string().optional().describe("Contact phone number."),
  parent_profile: nonEmptyString.optional().describe("Global profile PK enforced on all created devices."),
};

const deviceCreateInput = {
  name: nonEmptyString,
  client_count: nonEmptyString,
  profile_id: nonEmptyString,
  icon: nonEmptyString,
  profile_id2: nonEmptyString.optional(),
  stats: integer.min(0).max(2).optional(),
  legacy_ipv4_status: binaryStatus.optional(),
  learn_ip: binaryStatus.optional(),
  restricted: binaryStatus.optional(),
  desc: z.string().optional(),
  ddns_status: binaryStatus.optional(),
  ddns_subdomain: nonEmptyString.optional(),
  ddns_ext_status: binaryStatus.optional(),
  ddns_ext_host: nonEmptyString.optional(),
  remap_device_id: nonEmptyString.optional(),
  remap_client_id: nonEmptyString.optional(),
};

const deviceUpdateInput = {
  name: nonEmptyString.optional(),
  client_count: nonEmptyString.optional(),
  profile_id: nonEmptyString.optional(),
  profile_id2: nonEmptyString.optional(),
  stats: integer.min(0).max(2).optional(),
  legacy_ipv4_status: binaryStatus.optional(),
  learn_ip: binaryStatus.optional(),
  restricted: binaryStatus.optional(),
  bump_tls: binaryStatus.optional(),
  desc: z.string().optional(),
  ddns_status: binaryStatus.optional(),
  ddns_subdomain: nonEmptyString.optional(),
  ddns_ext_host: nonEmptyString.optional(),
  ddns_ext_status: binaryStatus.optional(),
  status: integer.min(0).max(3).optional(),
  ctrld_custom_config: z.string().optional(),
};

export const writeTools: readonly ToolDefinition[] = [
  defineTool({
    name: "controld_create_profile",
    config: {
      description: "Create a blank Control D profile or clone an existing profile.",
      inputSchema: z.object({
        name: nonEmptyString,
        clone_profile_id: nonEmptyString.optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/profiles", {
      method: "POST",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_update_profile",
    config: {
      description: "Rename a Control D profile or change its disable-until timestamp.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        name: nonEmptyString.optional(),
        disable_ttl: integer.min(0).optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_delete_profile",
    config: {
      description: "Delete a Control D profile. The docs say only orphaned profiles delete successfully.",
      inputSchema: z.object({ profile_id: nonEmptyString, ...subOrgInput }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { profile_id, sub_org_id }) => client.request(
      `/profiles/${segment(profile_id)}`,
      { method: "DELETE", subOrgId: sub_org_id },
    ),
  }),
  defineTool({
    name: "controld_set_profile_option",
    config: {
      description: "Enable, disable, or set the value of a Control D profile option.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        name: nonEmptyString,
        status: binaryStatus,
        value: z.string().optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, name, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/options/${segment(name)}`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_set_filters",
    config: {
      description: "Set enabled or disabled status for Control D profile filters in a batch.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        filters: z.array(z.object({ filter: nonEmptyString, status: binaryStatus }).strict()).min(1),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, filters, sub_org_id }) => client.request(
      `/profiles/${segment(profile_id)}/filters`,
      {
        method: "PUT",
        body: { encoding: "json", value: { filters } },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_set_service_rule",
    config: {
      description: "Create or modify a service rule on a Control D profile.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        service: nonEmptyString,
        do: doCode,
        status: binaryStatus,
        via: nonEmptyString.optional(),
        via_v6: nonEmptyString.optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, service, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/services/${segment(service)}`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_set_default_rule",
    config: {
      description: "Set the default rule for a Control D profile.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        do: doCode,
        status: binaryStatus,
        via: nonEmptyString.optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/default`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_create_custom_rules",
    config: {
      description: "Create one or more custom rules on a Control D profile.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        hostnames: z.array(nonEmptyString).min(1),
        do: doCode,
        status: binaryStatus,
        via: nonEmptyString.optional(),
        via_v6: nonEmptyString.optional(),
        folder_id: z.union([nonEmptyString, integer.min(0)]).optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, folder_id, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/rules`,
      {
        method: "POST",
        body: { encoding: "form", value: { ...value, group: folder_id } },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_update_custom_rules",
    config: {
      description: "Update existing custom rules on a Control D profile. Rules are selected by hostname; hostnames not listed are untouched (live-verified).",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        hostnames: z.array(nonEmptyString).min(1),
        do: doCode,
        status: binaryStatus,
        via: nonEmptyString.optional(),
        via_v6: nonEmptyString.optional(),
        folder_id: z.union([nonEmptyString, integer.min(0)]).optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, folder_id, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/rules`,
      {
        method: "PUT",
        body: { encoding: "form", value: { ...value, group: folder_id } },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_delete_custom_rule",
    config: {
      description: "Delete a custom hostname rule from a Control D profile.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        hostname: nonEmptyString,
        ...subOrgInput,
      }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { profile_id, hostname, sub_org_id }) => client.request(
      `/profiles/${segment(profile_id)}/rules/${segment(hostname)}`,
      { method: "DELETE", subOrgId: sub_org_id },
    ),
  }),
  defineTool({
    name: "controld_create_rule_folder",
    config: {
      description: "Create a custom-rule folder and its inherited action.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        name: nonEmptyString,
        do: doCode,
        status: binaryStatus,
        via: nonEmptyString.optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/groups`,
      {
        method: "POST",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_update_rule_folder",
    config: {
      description: "Modify a custom-rule folder and its inherited action.",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        folder: nonEmptyString,
        do: doCode,
        status: binaryStatus,
        name: nonEmptyString.optional(),
        via: nonEmptyString.optional(),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { profile_id, folder, sub_org_id, ...value }) => client.request(
      `/profiles/${segment(profile_id)}/groups/${segment(folder)}`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_delete_rule_folder",
    config: {
      description: "Delete a custom-rule folder AND every rule inside it (cascade, live-verified).",
      inputSchema: z.object({
        profile_id: nonEmptyString,
        folder: z.union([nonEmptyString, integer.min(0)]),
        ...subOrgInput,
      }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { profile_id, folder, sub_org_id }) => client.request(
      `/profiles/${segment(profile_id)}/groups/${segment(folder)}`,
      { method: "DELETE", subOrgId: sub_org_id },
    ),
  }),
  defineTool({
    name: "controld_create_device",
    config: {
      description: "Create a Control D device and its DNS resolvers.",
      inputSchema: z.object({ ...deviceCreateInput, ...subOrgInput }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/devices", {
      method: "POST",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_update_device",
    config: {
      description: "Modify documented settings on a Control D device.",
      inputSchema: z.object({
        device_id: nonEmptyString,
        ...deviceUpdateInput,
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { device_id, sub_org_id, ...value }) => client.request(
      `/devices/${segment(device_id)}`,
      {
        method: "PUT",
        body: { encoding: "form", value },
        subOrgId: sub_org_id,
      },
    ),
  }),
  defineTool({
    name: "controld_delete_device",
    config: {
      description: "Delete a Control D device. This breaks DNS on devices using its resolvers.",
      inputSchema: z.object({ device_id: nonEmptyString, ...subOrgInput }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { device_id, sub_org_id }) => client.request(
      `/devices/${segment(device_id)}`,
      { method: "DELETE", subOrgId: sub_org_id },
    ),
  }),
  defineTool({
    name: "controld_authorize_ips",
    config: {
      description: "Authorize IPv4 or IPv6 addresses to use a Control D device.",
      inputSchema: z.object({
        device_id: nonEmptyString,
        ips: z.array(nonEmptyString).min(1),
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/access", {
      method: "POST",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_deauthorize_ips",
    config: {
      description: "Deauthorize IPv4 or IPv6 addresses from a Control D device.",
      inputSchema: z.object({
        device_id: nonEmptyString,
        ips: z.array(nonEmptyString).min(1),
        ...subOrgInput,
      }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/access", {
      method: "DELETE",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_create_suborg",
    config: {
      description: "Create a sub-organization. Organization accounts only.",
      inputSchema: z.object({
        name: nonEmptyString.describe("Organization name."),
        ...organizationInput,
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/organizations/suborg", {
      method: "POST",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_update_organization",
    config: {
      description: "Modify an organization's contact and policy details. Organization accounts only. UNVERIFIED: Control D documents the fields but no identifier parameter, and does not say how the target organization is chosen, so this tool has not been confirmed against a live account. It may modify an organization other than the one you intend. Ask the user to confirm before calling it, and re-read the organization afterwards to check what changed.",
      inputSchema: z.object({
        name: nonEmptyString.optional().describe("Organization name."),
        contact_email: nonEmptyString.optional().describe("Primary contact email for the organization."),
        twofa_req: organizationInput.twofa_req.optional(),
        stats_endpoint: nonEmptyString.optional().describe("Storage region PK. See controld_list_catalog with catalog 'analytics_regions'."),
        address: organizationInput.address,
        website: organizationInput.website,
        contact_name: organizationInput.contact_name,
        contact_phone: organizationInput.contact_phone,
        parent_profile: organizationInput.parent_profile,
        ...subOrgInput,
      }).strict(),
      annotations: writeAnnotations,
    },
    handler: (client, { sub_org_id, ...value }) => client.request("/organizations", {
      method: "PUT",
      body: { encoding: "form", value },
      subOrgId: sub_org_id,
    }),
  }),
  defineTool({
    name: "controld_request_write",
    config: {
      description: "Escape hatch: send a mutating request to any Control D API path with the write token. Use only when no typed tool covers what you need, because nothing here validates the body against the endpoint. Prefer the named tools, which check their inputs.",
      inputSchema: z.object({
        method: z.enum(["POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method."),
        path: apiPath,
        encoding: z.enum(["form", "json"]).default("form").describe("Body encoding. Control D documents form encoding for almost every write."),
        body: z.record(z.string().min(1), z.unknown()).optional().describe("Request body fields. Form encoding accepts strings, numbers, booleans, and arrays of those."),
        ...subOrgInput,
      }).strict(),
      annotations: destructiveAnnotations,
    },
    handler: (client, { method, path, encoding, body, sub_org_id }) => client.request(path, {
      method,
      subOrgId: sub_org_id,
      body: body === undefined
        ? undefined
        : encoding === "json"
          ? { encoding: "json", value: body }
          : { encoding: "form", value: rawFormBody.parse(body) },
    }),
  }),
] as const;
