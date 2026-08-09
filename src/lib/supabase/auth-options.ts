export const PKCE_FLOW_ID_QUERY_PARAM = "sb_flow_id";

export const SUPABASE_AUTH_OPTIONS = {
  experimental: {
    appendPkceFlowIdToRedirects: true,
  },
} as const;
