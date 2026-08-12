-- FineInvoice core application data model.
-- Run this migration in the Supabase project before enabling cloud persistence.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  company text,
  phone text,
  plan text not null default 'free' check (plan in ('free','single','lifetime')),
  single_credits integer not null default 3 check (single_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  company text,
  email text,
  phone text,
  address text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_number text,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft',
  currency text,
  total numeric(14,2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'polar',
  provider_payment_id text,
  plan text not null,
  amount numeric(14,2),
  currency text,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_id)
);

create index if not exists customers_user_id_idx on public.customers(user_id);
create index if not exists invoices_user_id_idx on public.invoices(user_id);
create index if not exists invoices_customer_id_idx on public.invoices(customer_id);
create index if not exists downloads_user_id_idx on public.invoice_downloads(user_id);
create index if not exists payments_user_id_idx on public.payments(user_id);

-- Automatically create a profile for every new Supabase Auth account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id,email,name,plan,single_credits)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1)),
    coalesce(new.raw_user_meta_data->>'plan','free'),
    coalesce((new.raw_user_meta_data->>'singleCredits')::integer,3)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill profiles for accounts that already exist.
insert into public.profiles (id,email,name,plan,single_credits)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'name', split_part(coalesce(email,''),'@',1)),
  coalesce(raw_user_meta_data->>'plan','free'),
  coalesce((raw_user_meta_data->>'singleCredits')::integer,3)
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_downloads enable row level security;
alter table public.payments enable row level security;

-- Profiles: users can read/update their own profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Customers: strict per-user isolation.
drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers for select to authenticated using (user_id = auth.uid());
drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own on public.customers for insert to authenticated with check (user_id = auth.uid());
drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists customers_delete_own on public.customers;
create policy customers_delete_own on public.customers for delete to authenticated using (user_id = auth.uid());

-- Invoices: strict per-user isolation.
drop policy if exists invoices_select_own on public.invoices;
create policy invoices_select_own on public.invoices for select to authenticated using (user_id = auth.uid());
drop policy if exists invoices_insert_own on public.invoices;
create policy invoices_insert_own on public.invoices for insert to authenticated with check (user_id = auth.uid());
drop policy if exists invoices_update_own on public.invoices;
create policy invoices_update_own on public.invoices for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists invoices_delete_own on public.invoices;
create policy invoices_delete_own on public.invoices for delete to authenticated using (user_id = auth.uid());

-- Download log: users can create/read only their own records.
drop policy if exists downloads_select_own on public.invoice_downloads;
create policy downloads_select_own on public.invoice_downloads for select to authenticated using (user_id = auth.uid());
drop policy if exists downloads_insert_own on public.invoice_downloads;
create policy downloads_insert_own on public.invoice_downloads for insert to authenticated with check (user_id = auth.uid());

-- Payments are intentionally not writable from the browser. Payment providers
-- and server-side webhook functions should create/update these records.
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated using (user_id = auth.uid());

-- Keep updated_at current for mutable core records.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();
drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at before update on public.customers for each row execute procedure public.touch_updated_at();
drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at before update on public.invoices for each row execute procedure public.touch_updated_at();
drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at before update on public.payments for each row execute procedure public.touch_updated_at();
