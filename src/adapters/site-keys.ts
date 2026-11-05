/**
 * Some sites publish a Supabase anon key in their own web client. Set it in the
 * named env var to scan that site. A missing key is a site failure, not a crash.
 */
export function requireSiteKey(envVar: string): string {
  const key = process.env[envVar]?.trim();
  if (!key) throw new Error(`Set ${envVar} to scan this site`);
  return key;
}
