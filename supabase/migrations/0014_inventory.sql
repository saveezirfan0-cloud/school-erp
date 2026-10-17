-- ============================================================
-- 0014  Inventory: storage unit, stock checkout approvals, reception sales
-- ------------------------------------------------------------
-- Tables
--   inventory_items      one row per item kept in the storage unit (the
--                        "Current Stock Status" sheet): code, name, price,
--                        opening stock, opening stock already at reception,
--                        low-stock level.
--   inventory_movements  the "Daily In-Out Log": every stock in / stock out.
--                        A movement only changes stock once it is APPROVED.
--                        Staff submit checkouts as 'pending'; an approver
--                        ticks them ('approved') or turns them down ('rejected').
--   reception_sales      items sold at reception: buyer, item, quantity,
--                        date, paid / unpaid.
-- Stock is never stored, it is computed:
--   storage stock   = opening_stock + approved in - approved out
--   reception stock = reception_opening + approved out to "Reception" - sold
-- so a pending checkout cannot change the storage figure, whatever the app does.
--
-- Permissions (new keys, also in src/context/UserContext.jsx)
--   canViewInventory     see Storage and Reception Inventory
--   canEditInventory     submit checkouts / stock-in requests, record reception sales
--   canApproveInventory  approve or reject movements, manage the item list
--   Admin has all three. branch_manager and fee_collector get view + edit.
--   inventory_perm() resolves them exactly like the app does (admin, then the
--   per-user override from Access Control, then the role default, then
--   has_perm() for custom roles), so it works the same whether or not
--   0001-0013 have been applied.
--
-- Database rules (trigger trg_inventory_movement_guard)
--   * only an approver may create a movement that is not 'pending', change a
--     movement's status, or change a movement that is no longer pending;
--   * requested_by is always the signed-in user; reviewed_by / reviewed_at are
--     stamped by the database when the status changes;
--   * approving a stock-out (or any change that lowers stock) is refused when
--     the storage unit does not hold enough; the item row is locked so two
--     approvals at once cannot both pass.
--
-- Depends on : the baseline scripts only (schema.sql, security.sql: users,
--              custom_roles, set_updated_at, has_perm). Self-contained: it
--              does NOT need migrations 0001-0013 and can run before or after
--              them. If 0008 is present its row_history audit is attached.
-- Idempotent : yes
-- Data change: none (new tables only)
-- Rollback   : drop table public.reception_sales, public.inventory_movements,
--              public.inventory_items cascade; drop function public.inventory_perm(text),
--              public.inventory_stock(uuid, uuid), public.inventory_movement_guard().
-- ============================================================
begin;
-- ---------- permission helper ----------
create or replace function public.inventory_perm(perm text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r  text;
  ov jsonb;
begin
  if auth.uid() is null then return false; end if;
  select u.role, u.extra -> 'pagePermissions' into r, ov from public.users u where u.id = auth.uid();
  if r is null or r = 'none' then return false; end if;
  if r = 'admin' then return true; end if;
  -- per-user override set by an admin in Access Control
  if jsonb_typeof(ov) = 'object' and ov ? perm then
    return coalesce((ov -> perm) = 'true'::jsonb, false);
  end if;
  -- built-in defaults (mirror of UserContext PERMISSIONS)
  if r in ('branch_manager', 'fee_collector') and perm in ('canViewInventory', 'canEditInventory') then
    return true;
  end if;
  if r in ('branch_manager', 'fee_collector', 'accountant', 'teacher') then return false; end if;
  -- custom roles
  return public.has_perm(perm);
end $$;
revoke all on function public.inventory_perm(text) from public, anon;
grant execute on function public.inventory_perm(text) to authenticated;

-- ---------- tables ----------
create table if not exists public.inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  code               text,
  name               text not null,
  unit_price         numeric not null default 0,
  opening_stock      numeric not null default 0,
  reception_opening  numeric not null default 0,
  low_stock_level    numeric not null default 10,
  extra              jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  constraint inventory_items_name_chk   check (btrim(name) <> ''),
  constraint inventory_items_values_chk check (unit_price >= 0 and opening_stock >= 0
                                               and reception_opening >= 0 and low_stock_level >= 0)
);

create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.inventory_items (id) on delete restrict,
  direction    text not null,
  quantity     numeric not null,
  date         text not null,
  destination  text,          -- out: where it went (Reception, Office, a branch...); in: supplier
  person       text,          -- who took it / who brought it
  reason       text,
  slip_no      text,
  status       text not null default 'pending',
  requested_by uuid,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  extra        jsonb default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint inventory_movements_direction_chk check (direction in ('in', 'out')),
  constraint inventory_movements_quantity_chk  check (quantity > 0),
  constraint inventory_movements_status_chk    check (status in ('pending', 'approved', 'rejected')),
  constraint inventory_movements_date_iso      check (date ~ '^\d{4}-\d{2}-\d{2}$')
);

create table if not exists public.reception_sales (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.inventory_items (id) on delete restrict,
  buyer_name  text not null,
  quantity    numeric not null,
  unit_price  numeric,
  amount      numeric,
  date        text not null,
  paid        boolean not null default false,
  paid_date   text,
  extra       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint reception_sales_buyer_chk    check (btrim(buyer_name) <> ''),
  constraint reception_sales_quantity_chk check (quantity > 0),
  constraint reception_sales_amount_chk   check (coalesce(amount, 0) >= 0 and coalesce(unit_price, 0) >= 0),
  constraint reception_sales_date_iso     check (date ~ '^\d{4}-\d{2}-\d{2}$')
);

create index if not exists inventory_movements_item_idx   on public.inventory_movements (item_id);
create index if not exists inventory_movements_status_idx on public.inventory_movements (status) where status = 'pending';
create index if not exists reception_sales_item_idx       on public.reception_sales (item_id);

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_movements','reception_sales'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                      for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- stock helper ----------
-- Storage stock of one item from APPROVED movements, optionally leaving one
-- movement out (the row being written, whose new effect the caller adds).
-- Called from the BEFORE ROW guard it sees the rows already written by the
-- same statement, so a bulk approve (one UPDATE over several ids) or a bulk
-- import is checked row by row (policy_matrix.sql section 14 tests this).
create or replace function public.inventory_stock(p_item_id uuid, p_exclude uuid default null)
returns numeric language sql volatile security definer set search_path = public, pg_temp as $$
  select coalesce((select i.opening_stock from public.inventory_items i where i.id = p_item_id), 0)
       + coalesce((select sum(case m.direction when 'in' then m.quantity else -m.quantity end)
                     from public.inventory_movements m
                    where m.item_id = p_item_id and m.status = 'approved'
                      and (p_exclude is null or m.id <> p_exclude)), 0)
$$;
revoke all on function public.inventory_stock(uuid, uuid) from public, anon;
grant execute on function public.inventory_stock(uuid, uuid) to authenticated;

-- ---------- approval guard ----------
create or replace function public.inventory_movement_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  approver   boolean;
  eff_new    numeric;
  eff_old    numeric := 0;
  have       numeric;
  item_label text;
begin
  -- SQL editor / service role / imports: trusted, like the other guards.
  if auth.uid() is null then return new; end if;
  approver := public.inventory_perm('canApproveInventory');

  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    if new.status <> 'pending' and not approver then
      raise exception 'only an approver can record a movement as %', new.status
        using errcode = '42501', hint = 'submit it as pending and wait for approval';
    end if;
    if new.status <> 'pending' then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  else
    new.requested_by := old.requested_by;            -- who asked never changes
    if (old.status <> 'pending' or new.status <> old.status) and not approver then
      raise exception 'only an approver can approve, reject or change a reviewed movement'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      new.reviewed_by := case when new.status = 'pending' then null else auth.uid() end;
      new.reviewed_at := case when new.status = 'pending' then null else now() end;
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
    if old.status = 'approved' then
      eff_old := case old.direction when 'in' then old.quantity else -old.quantity end;
    end if;
  end if;

  -- Stock check: whenever this write lowers an item's storage stock, the
  -- result must not go below zero. The item row is locked so concurrent
  -- approvals of the same item are serialised.
  eff_new := case when new.status = 'approved'
                  then case new.direction when 'in' then new.quantity else -new.quantity end
                  else 0 end;

  if tg_op = 'UPDATE' and old.item_id is distinct from new.item_id and eff_old > 0 then
    perform 1 from public.inventory_items where id = old.item_id for update;
    have := public.inventory_stock(old.item_id, old.id);
    if have < 0 then
      raise exception 'not enough stock left of the original item to move this entry'
        using errcode = '23514';
    end if;
    eff_old := 0;
  elsif tg_op = 'UPDATE' and old.item_id is distinct from new.item_id then
    eff_old := 0;
  end if;

  if eff_new < eff_old then
    select name into item_label from public.inventory_items where id = new.item_id for update;
    have := public.inventory_stock(new.item_id, new.id);
    if have + eff_new < 0 then
      raise exception 'not enough stock: % has % in storage, this needs %',
        coalesce(item_label, 'the item'), have, -eff_new
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.inventory_movement_guard() from public, anon, authenticated;

drop trigger if exists trg_inventory_movement_guard on public.inventory_movements;
create trigger trg_inventory_movement_guard before insert or update on public.inventory_movements
  for each row execute function public.inventory_movement_guard();

-- ---------- row-level security ----------
do $$
declare
  t text;
  p record;
  can_read constant text :=
    $s$((select public.inventory_perm('canViewInventory')) or (select public.inventory_perm('canEditInventory')) or (select public.inventory_perm('canApproveInventory')))$s$;
  can_edit constant text :=
    $s$((select public.inventory_perm('canEditInventory')) or (select public.inventory_perm('canApproveInventory')))$s$;
  can_approve constant text := $s$(select public.inventory_perm('canApproveInventory'))$s$;
begin
  foreach t in array array['inventory_items','inventory_movements','reception_sales'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (%2$s)', t, can_read);
  end loop;

  -- the item list (and opening stock) is the approver's
  create policy inventory_items_insert on public.inventory_items for insert to authenticated with check ((select public.inventory_perm('canApproveInventory')));
  create policy inventory_items_update on public.inventory_items for update to authenticated using ((select public.inventory_perm('canApproveInventory'))) with check ((select public.inventory_perm('canApproveInventory')));
  create policy inventory_items_delete on public.inventory_items for delete to authenticated using ((select public.inventory_perm('canApproveInventory')));

  -- movements: staff write pending rows (the guard trigger enforces the status
  -- rules); an approved movement can only be deleted by an approver
  execute format('create policy inventory_movements_insert on public.inventory_movements for insert to authenticated with check (%s)', can_edit);
  execute format('create policy inventory_movements_update on public.inventory_movements for update to authenticated using (%1$s) with check (%1$s)', can_edit);
  execute format('create policy inventory_movements_delete on public.inventory_movements for delete to authenticated using (%s or (%s and status <> ''approved''))', can_approve, can_edit);

  execute format('create policy reception_sales_insert on public.reception_sales for insert to authenticated with check (%s)', can_edit);
  execute format('create policy reception_sales_update on public.reception_sales for update to authenticated using (%1$s) with check (%1$s)', can_edit);
  execute format('create policy reception_sales_delete on public.reception_sales for delete to authenticated using (%s)', can_edit);

  -- ---------- audit (row_history from 0008, when it is installed) ----------
  if to_regprocedure('public.capture_history()') is not null then
    foreach t in array array['inventory_items','inventory_movements','reception_sales'] loop
      execute format('drop trigger if exists trg_%1$s_history on public.%1$I', t);
      execute format('create trigger trg_%1$s_history after insert or update or delete on public.%1$I
                        for each row execute function public.capture_history()', t);
    end loop;
  end if;

  -- ---------- realtime ----------
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['inventory_items','inventory_movements','reception_sales'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  else
    raise notice 'publication supabase_realtime not found; inventory tables not published';
  end if;
end $$;

commit;

-- Check: should list the three inventory tables
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('inventory_items', 'inventory_movements', 'reception_sales')
order by 1;
