-- Sick days per seller, marked by admin in a calendar on the salary page.
-- Salary calc deducts per Swedish rules (karensavdrag, 80% sjuklön day 1-14,
-- full deduction from day 15 when Försäkringskassan takes over).
create table public.sick_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

alter table public.sick_days enable row level security;

create policy "sick_days_select_self_or_admin"
  on public.sick_days for select to authenticated
  using (user_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

create policy "sick_days_insert_admin"
  on public.sick_days for insert to authenticated
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "sick_days_delete_admin"
  on public.sick_days for delete to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
