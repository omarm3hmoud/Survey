/*
 * DawaNetwork survey — deployment configuration.
 *
 * Fill in your own Supabase project's URL and "anon" public key below, then
 * the form will submit responses straight to your database. Until you do,
 * the app runs in local-only mode: it saves answers in the visitor's own
 * browser and lets you export them, but it does NOT collect responses from
 * other people's devices over the internet.
 *
 * Where to find these two values: Supabase dashboard → Project Settings →
 * API → "Project URL" and "anon public" key.
 *
 * The anon/public key is designed by Supabase to be used in client-side code
 * like this — it is not a secret. Row Level Security (set up by
 * supabase/schema.sql) is what actually controls who can read or write data,
 * so never put your "service_role" (secret) key here or in any file that
 * ships to the browser.
 */
window.SUPABASE_CONFIG = {
  url: "https://uurmhochbphjfyrhmxdx.supabase.co",
  anonKey: "sb_publishable_KrSK0cGFjmv2uWLnzcAn6g_ZI3cYVUH"
};

