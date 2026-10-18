import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://fineinvoice.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Not authorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  const email = auth.user?.email?.toLowerCase();
  if (authError || !email || !ADMIN_EMAILS.includes(email)) return respond({ error: "Not authorized" }, 403);

  const [invoiceResult, customerResult, usersResult] = await Promise.all([
    admin.from("invoices").select("*").order("created_at", { ascending: false }),
    admin.from("customers").select("*").order("created_at", { ascending: false }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (invoiceResult.error) return respond({ error: "Could not load invoices" }, 500);
  if (customerResult.error) return respond({ error: "Could not load customers" }, 500);
  if (usersResult.error) return respond({ error: "Could not load account directory" }, 500);

  const users = usersResult.data.users ?? [];
  const userById = new Map(users.map((u) => [u.id, {
    email: u.email ?? "",
    name: String(u.user_metadata?.name ?? u.user_metadata?.full_name ?? u.email ?? ""),
  }]));
  const invoices = (invoiceResult.data ?? []).map((row) => ({
    ...row,
    account_email: userById.get(row.user_id)?.email ?? "",
    account_name: userById.get(row.user_id)?.name ?? "",
  }));
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of customerResult.data ?? []) {
    const owner = userById.get(row.user_id);
    const key = [row.user_id ?? "", String(row.email ?? "").trim().toLowerCase(), String(row.name ?? "").trim().toLowerCase()].join("|");
    grouped.set(key, {
      id: row.id, user_id: row.user_id, name: row.name ?? "", company: row.company ?? "",
      email: row.email ?? "", phone: row.phone ?? "", address: row.address ?? "",
      created_at: row.created_at ?? "", account_email: owner?.email ?? "",
      account_name: owner?.name ?? "", source: "customer_record", invoices: [],
    });
  }
  for (const inv of invoices) {
    const p = inv.payload && typeof inv.payload === "object" ? inv.payload as Record<string, unknown> : {};
    const name = String(inv.customer ?? p.customer ?? "").trim();
    if (!name) continue;
    const customerEmail = String(inv.cust_email ?? p.custEmail ?? p.customerEmail ?? "").trim();
    const key = [inv.user_id ?? "", customerEmail.toLowerCase(), name.toLowerCase()].join("|");
    // Invoices often have no customer email even when a saved profile does.
    // In that case, safely match by the same account and exact normalized customer name.
    // Never match across accounts, and only use the fallback when it is unambiguous.
    let entry = grouped.get(key);
    if (!entry && !customerEmail) {
      const sameAccountAndName = [...grouped.entries()].filter(([groupKey, candidate]) =>
        String(candidate.user_id ?? "") === String(inv.user_id ?? "") &&
        String(candidate.name ?? "").trim().toLowerCase() === name.toLowerCase()
      );
      if (sameAccountAndName.length === 1) entry = sameAccountAndName[0][1];
    }
    if (!entry) {
      entry = {
        id: "invoice-customer:" + key, user_id: inv.user_id, name, company: "",
        email: customerEmail, phone: String(p.custPhone ?? p.customerPhone ?? ""),
        address: String(p.custAddress ?? p.customerAddress ?? ""), created_at: inv.created_at ?? "",
        account_email: inv.account_email ?? "", account_name: inv.account_name ?? "", source: "invoice", invoices: [],
      };
      grouped.set(key, entry);
    }
    // Fill gaps from the saved invoice only; preserve any existing saved customer-profile fields.
    const invoiceCompany = String(inv.company ?? p.company ?? "").trim();
    const invoicePhone = String(inv.cust_phone ?? p.custPhone ?? p.customerPhone ?? "").trim();
    const invoiceAddress = String(inv.cust_address ?? p.custAddress ?? p.customerAddress ?? "").trim();
    if (!entry.company && invoiceCompany) entry.company = invoiceCompany;
    if (!entry.email && customerEmail) entry.email = customerEmail;
    if (!entry.phone && invoicePhone) entry.phone = invoicePhone;
    if (!entry.address && invoiceAddress) entry.address = invoiceAddress;
    (entry.invoices as unknown[]).push({
      id: inv.id, inv_number: inv.inv_number, inv_date: inv.inv_date, created_at: inv.created_at,
      currency: inv.currency, total: inv.total, status: inv.status, notes: inv.notes,
    });
    grouped.set(key, entry);
  }
  return respond({ data: { invoices, customers: [...grouped.values()], accounts: users.map((u) => ({
    id: u.id, email: u.email ?? "", name: String(u.user_metadata?.name ?? u.user_metadata?.full_name ?? u.email ?? ""),
  })) } });
});
