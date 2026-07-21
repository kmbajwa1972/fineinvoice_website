// Admin-only actions on payment_submissions (list all / verify + issue code).
//
// Called from admin.html with the signed-in user's Supabase access token.
// Authorization happens here, server-side, against ADMIN_EMAILS — the
// service-role key never reaches the browser, so this closes the exploit
// where anyone could call the table directly with the public anon key.
//
// Deploy: supabase functions deploy admin-payments
// Configure once: supabase secrets set ADMIN_EMAILS=you@example.com
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // narrow to your production origin once live
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function generateUnlockCode() {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${part()}-${part()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return jsonResponse({ error: "Not authorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userResult, error: userErr } = await admin.auth.getUser(token);
  const callerEmail = userResult?.user?.email?.toLowerCase();
  if (userErr || !callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }

  let body: { action?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (body.action === "list") {
    const { data, error } = await admin
      .from("payment_submissions")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ data });
  }

  if (body.action === "verify") {
    if (!body.id) return jsonResponse({ error: "Missing id" }, 400);
    const code = generateUnlockCode();
    const { data, error } = await admin
      .from("payment_submissions")
      .update({ status: "verified", unlock_code: code, verified_at: new Date().toISOString() })
      .eq("id", body.id)
      .select()
      .single();
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ data });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
