import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required to prepare E2E Auth users.",
  );
}

const authHost = new URL(supabaseUrl).hostname;
if (!["127.0.0.1", "localhost", "[::1]"].includes(authHost)) {
  throw new Error("E2E Auth preparation is restricted to a loopback Supabase instance.");
}

const syntheticUsers = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001", email: "admin@example.edu" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002", email: "reviewer@example.edu" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003", email: "member@example.edu" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004", email: "leader@example.edu" },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005",
    email: "expired-reviewer@example.edu",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006",
    email: "vice-president@example.edu",
  },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007", email: "multi-role@example.edu" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008", email: "expired-member@example.edu" },
];

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const user of syntheticUsers) {
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updateError) {
    throw new Error(`Could not prepare synthetic Auth user ${user.id}: ${updateError.message}`);
  }
}

// One real password grant proves the running Auth service accepted the managed
// password lifecycle without spending the local rate-limit budget for all users.
const representativeUser = syntheticUsers.find((user) => user.email === "member@example.edu");
if (!representativeUser) {
  throw new Error("The representative synthetic Auth user is missing.");
}
const { data, error: signInError } = await authClient.auth.signInWithPassword({
  email: representativeUser.email,
  password,
});
if (signInError || data.user?.id !== representativeUser.id) {
  throw new Error(`Synthetic password sign-in verification failed for ${representativeUser.id}.`);
}
await authClient.auth.signOut();

console.log(
  `Prepared ${syntheticUsers.length} synthetic E2E Auth users and verified one password grant.`,
);
