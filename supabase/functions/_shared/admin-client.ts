import { createClient } from "npm:@supabase/supabase-js@2.111.0";

/**
 * Server-side Supabase client. New-format secret keys must reach the REST
 * API only in the apikey header, never as a Bearer token.
 */
export function createAdminClient(supabaseUrl: string, serviceKey: string) {
  const adminFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("apikey", serviceKey);
    headers.delete("Authorization");
    return fetch(input, { ...init, headers });
  };
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: adminFetch },
  });
}
