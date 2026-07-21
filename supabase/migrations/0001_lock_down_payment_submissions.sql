-- Locks down public.payment_submissions so the anon/authenticated Supabase
-- key (shipped in the client JS) can no longer read every customer's PII or
-- write arbitrary status/unlock_code changes directly from the browser.
--
-- Before running: check what policies already exist on this table —
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where tablename = 'payment_submissions';
-- Drop any pre-existing SELECT/UPDATE/DELETE policies you find there (their
-- names will vary by project since they weren't created by this file) —
-- otherwise they'll keep allowing the direct-access exploit alongside these.

alter table public.payment_submissions enable row level security;

-- Anyone may submit a payment record (the public "Submit Payment" form).
drop policy if exists "payment_submissions_public_insert" on public.payment_submissions;
create policy "payment_submissions_public_insert"
  on public.payment_submissions
  for insert
  to anon, authenticated
  with check (true);

-- Intentionally no SELECT/UPDATE/DELETE policy for anon/authenticated:
-- RLS defaults to deny, so direct table reads/writes from the client are
-- blocked. All admin listing/verification goes through the admin-payments
-- Edge Function (service-role key, never shipped to the client). All
-- customer-side code redemption goes through the two RPCs below, which are
-- SECURITY DEFINER and return/touch only the narrow fields needed.

create or replace function public.redeem_unlock_code(p_code text)
returns table (id uuid, plan text, whatsapp text)
language sql
security definer
set search_path = public
as $$
  select id, plan, whatsapp
  from public.payment_submissions
  where unlock_code = p_code
    and status = 'verified'
  limit 1;
$$;

revoke all on function public.redeem_unlock_code(text) from public;
grant execute on function public.redeem_unlock_code(text) to anon, authenticated;

create or replace function public.mark_unlock_code_used(p_id uuid, p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_submissions
  set status = 'used', used_at = now()
  where id = p_id
    and unlock_code = p_code
    and status = 'verified';
$$;

revoke all on function public.mark_unlock_code_used(uuid, text) from public;
grant execute on function public.mark_unlock_code_used(uuid, text) to anon, authenticated;
