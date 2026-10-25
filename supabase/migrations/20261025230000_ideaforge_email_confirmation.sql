-- IdeaForge payment-confirmation outbox.
-- Apply only after the existing IdeaForge schema.sql has been installed.

create table public.ideaforge_email_outbox (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.ideaforge_teams (id) on delete cascade,
  kind text not null default 'payment_confirmation'
    check (kind = 'payment_confirmation'),
  recipient_email text,
  recipient_name text,
  team_name text not null,
  member_names text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retryable boolean not null default false,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  constraint ideaforge_email_outbox_one_confirmation_per_team
    unique (team_id, kind)
);

create index ideaforge_email_outbox_ready_idx
  on public.ideaforge_email_outbox (next_attempt_at, created_at)
  where status = 'pending';

alter table public.ideaforge_email_outbox enable row level security;

revoke all on public.ideaforge_email_outbox from anon, authenticated;
grant select on public.ideaforge_email_outbox to authenticated;
grant select, update on public.ideaforge_email_outbox to service_role;

create policy "IdeaForge admins can view email outbox"
  on public.ideaforge_email_outbox
  for select
  to authenticated
  using (public.is_ideaforge_admin());

create function public.ideaforge_queue_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_recipient_email text;
  v_recipient_name text;
  v_member_names text[];
begin
  select m.email, m.full_name
  into v_recipient_email, v_recipient_name
  from public.ideaforge_members m
  where m.team_id = new.id
  order by m.is_team_contact desc, m.created_at, m.id
  limit 1;

  select coalesce(
    array_agg(m.full_name order by m.is_team_contact desc, m.created_at, m.id),
    '{}'::text[]
  )
  into v_member_names
  from public.ideaforge_members m
  where m.team_id = new.id;

  insert into public.ideaforge_email_outbox (
    team_id,
    recipient_email,
    recipient_name,
    team_name,
    member_names,
    status,
    last_error
  )
  values (
    new.id,
    v_recipient_email,
    v_recipient_name,
    new.team_name,
    v_member_names,
    case when v_recipient_email is null then 'failed' else 'pending' end,
    case
      when v_recipient_email is null
        then 'No team member email was available at approval time.'
      else null
    end
  )
  on conflict (team_id, kind) do nothing;

  return new;
end;
$$;

revoke all on function public.ideaforge_queue_payment_confirmation() from public;

create trigger ideaforge_payment_confirmation_on_approval
  after update of payment_status on public.ideaforge_teams
  for each row
  when (
    old.payment_status = 'pending_review'
    and new.payment_status = 'approved'
  )
  execute function public.ideaforge_queue_payment_confirmation();

create function public.ideaforge_email_claim(p_limit integer default 20)
returns table (
  id uuid,
  team_id uuid,
  recipient_email text,
  recipient_name text,
  team_name text,
  member_names text[],
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_remaining integer;
  v_limit integer;
begin
  if p_limit is null or p_limit < 1 then
    return;
  end if;

  perform pg_advisory_xact_lock(73821941, 1);

  select greatest(
    0,
    200
      - count(*) filter (where o.status = 'sent' and o.sent_at >= now() - interval '24 hours')
      - count(*) filter (where o.status = 'sending')
  )::integer
  into v_remaining
  from public.ideaforge_email_outbox o;

  v_limit := least(p_limit, v_remaining, 100);
  if v_limit < 1 then
    return;
  end if;

  return query
  with candidates as (
    select o.id
    from public.ideaforge_email_outbox o
    where o.status = 'pending'
      and o.next_attempt_at <= now()
      and o.attempt_count < 5
    order by o.next_attempt_at, o.created_at
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.ideaforge_email_outbox o
    set status = 'sending',
        attempt_count = o.attempt_count + 1,
        locked_at = now(),
        last_error = null
    from candidates c
    where o.id = c.id
    returning o.id, o.team_id, o.recipient_email, o.recipient_name,
      o.team_name, o.member_names, o.attempt_count
  )
  select c.id, c.team_id, c.recipient_email, c.recipient_name,
    c.team_name, c.member_names, c.attempt_count
  from claimed c;
end;
$$;

revoke all on function public.ideaforge_email_claim(integer) from public, anon, authenticated;
grant execute on function public.ideaforge_email_claim(integer) to service_role;

create function public.ideaforge_email_retry(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_ideaforge_admin() then
    raise exception 'Only IdeaForge admins may retry email jobs'
      using errcode = '42501';
  end if;

  update public.ideaforge_email_outbox
  set status = 'pending',
      attempt_count = 0,
      retryable = false,
      next_attempt_at = now(),
      last_error = 'Manually requeued by an authorized IdeaForge admin.'
  where id = p_id
    and status = 'failed'
    and retryable;

  return found;
end;
$$;

revoke all on function public.ideaforge_email_retry(uuid) from public, anon;
grant execute on function public.ideaforge_email_retry(uuid) to authenticated;
