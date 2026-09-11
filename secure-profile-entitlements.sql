-- Party Biz Hub production security migration
-- Run once in Supabase > SQL Editor before publishing the checkout update.

alter table profiles alter column has_paid set default false;

create or replace function protect_profile_entitlements()
returns trigger
language plpgsql
security invoker
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.has_paid := false;
      new.has_kpps_access := false;
      new.has_printables_access := false;
      new.has_crm_access := false;
      new.stripe_customer_id := null;
      new.library_tier := 'tier1';
    else
      new.has_paid := old.has_paid;
      new.has_kpps_access := old.has_kpps_access;
      new.has_printables_access := old.has_printables_access;
      new.has_crm_access := old.has_crm_access;
      new.stripe_customer_id := old.stripe_customer_id;
      new.library_tier := old.library_tier;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_entitlements on profiles;
create trigger profiles_protect_entitlements
  before insert or update on profiles
  for each row execute function protect_profile_entitlements();
