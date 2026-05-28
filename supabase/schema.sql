-- ─────────────────────────────────────────────
-- Lumen Finance · Supabase schema  (idempotent — safe to re-run)
-- Run this in the Supabase SQL editor
-- ─────────────────────────────────────────────

-- ── Portfolios ──────────────────────────────────────────────────────────────
create table if not exists portfolios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'My Portfolio',
  currency    text not null default 'THB',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table portfolios enable row level security;
drop policy if exists "Users can manage own portfolios" on portfolios;
create policy "Users can manage own portfolios"
  on portfolios for all using (auth.uid() = user_id);

-- ── Holdings ────────────────────────────────────────────────────────────────
create table if not exists holdings (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  ticker       text not null,
  name         text not null,
  sector       text,
  region       text,
  asset_class  text not null default 'Equity',
  shares       numeric not null default 0,
  cost_price   numeric not null default 0,
  currency     text not null default 'THB',
  div_yield      numeric default 0,
  div_frequency  integer default 4,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table holdings enable row level security;
drop policy if exists "Users can manage own holdings" on holdings;
create policy "Users can manage own holdings"
  on holdings for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()));

-- ── Transactions ─────────────────────────────────────────────────────────────
create table if not exists transactions (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  holding_id   uuid references holdings(id) on delete set null,
  type         text not null check (type in ('Buy','Sell','Dividend','Deposit','Withdraw')),
  ticker       text,
  shares       numeric,
  price        numeric,
  amount       numeric,
  currency     text not null default 'THB',
  fee          numeric default 0,
  tax          numeric default 0,
  transacted_at date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);
alter table transactions enable row level security;
drop policy if exists "Users can manage own transactions" on transactions;
create policy "Users can manage own transactions"
  on transactions for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()));

-- ── Goals ────────────────────────────────────────────────────────────────────
create table if not exists goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  icon         text default 'leaf',
  color        text default 'var(--c1)',
  target       numeric not null,
  current      numeric not null default 0,
  monthly_contribution numeric default 0,
  eta_year     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table goals enable row level security;
drop policy if exists "Users can manage own goals" on goals;
create policy "Users can manage own goals"
  on goals for all using (auth.uid() = user_id);

-- ── Cash balances ────────────────────────────────────────────────────────────
create table if not exists cash_accounts (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  label        text not null default 'Cash',
  balance      numeric not null default 0,
  currency     text not null default 'THB',
  updated_at   timestamptz not null default now()
);
alter table cash_accounts enable row level security;
drop policy if exists "Users can manage own cash accounts" on cash_accounts;
create policy "Users can manage own cash accounts"
  on cash_accounts for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()));

-- ── Price cache (shared read cache, no sensitive data) ───────────────────────
create table if not exists price_cache (
  ticker       text primary key,
  price        numeric not null,
  currency     text not null default 'THB',
  fetched_at   timestamptz not null default now()
);
alter table price_cache enable row level security;
drop policy if exists "Price cache is publicly readable" on price_cache;
create policy "Price cache is publicly readable"
  on price_cache for select using (true);

-- ── Portfolio value snapshots (one row per day → TWR / Sharpe / drawdown) ─────
create table if not exists portfolio_snapshots (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  date         date not null default current_date,
  total_value  numeric not null default 0,
  total_cost   numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (portfolio_id, date)
);
alter table portfolio_snapshots enable row level security;
drop policy if exists "Users can manage own snapshots" on portfolio_snapshots;
create policy "Users can manage own snapshots"
  on portfolio_snapshots for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()));
-- Table-level privileges (RLS still restricts rows to the owner)
grant select, insert, update, delete on table portfolio_snapshots to authenticated;
grant select, insert, update, delete on table portfolio_snapshots to service_role;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists holdings_portfolio_idx on holdings(portfolio_id);
create index if not exists transactions_portfolio_idx on transactions(portfolio_id);
create index if not exists transactions_date_idx on transactions(transacted_at desc);
create index if not exists goals_user_idx on goals(user_id);
create index if not exists snapshots_portfolio_idx on portfolio_snapshots(portfolio_id, date);
