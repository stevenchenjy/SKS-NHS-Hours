import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY are required to prepare E2E Auth users.",
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

const adminClient = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const authClient = createClient(supabaseUrl, publishableKey, {
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

// Browser approval tests use a teacher account separate from the owner. This
// fixture is local-only and does not change the database suite's seeded counts.
const { data: localUsers, error: listError } = await adminClient.auth.admin.listUsers({
  perPage: 1000,
});
if (listError) throw listError;
let teacher = localUsers.users.find((user) => user.email === "teacher@example.edu");
if (!teacher) {
  const { data, error } = await adminClient.auth.admin.createUser({
    email: "teacher@example.edu",
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("Could not create local teacher fixture");
  teacher = data.user;
} else {
  const { error } = await adminClient.auth.admin.updateUserById(teacher.id, {
    password,
    email_confirm: true,
  });
  if (error) throw error;
}
const { error: teacherProfileError } = await adminClient.from("profiles").upsert({
  id: teacher.id,
  email: teacher.email,
  full_name: "Terry Teacher",
});
if (teacherProfileError) throw teacherProfileError;
const { error: teacherGrantError } = await adminClient.from("platform_access_grants").upsert({
  profile_id: teacher.id,
  access_level: "teacher_admin",
  granted_by_profile_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001",
});
if (teacherGrantError) throw teacherGrantError;

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
  const failure = signInError
    ? `${signInError.name} (${signInError.status ?? "unknown status"}, ${signInError.code ?? "unknown code"}): ${signInError.message}`
    : `Auth returned unexpected user ${data.user?.id ?? "none"}`;
  throw new Error(
    `Synthetic password sign-in verification failed for ${representativeUser.id}: ${failure}`,
  );
}
await authClient.auth.signOut();

console.log(
  `Prepared ${syntheticUsers.length} synthetic E2E Auth users and verified one password grant.`,
);
