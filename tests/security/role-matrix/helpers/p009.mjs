import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { queryLocalSql } from './local-stack.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const scalar = async (stack, toolchain, env, sql) => queryLocalSql(stack, toolchain.dockerBin, env, sql);
const deniedOrEmpty = ({ data, error }) => Boolean(error) || (Array.isArray(data) && data.length === 0);

async function sqlSucceeds(stack, toolchain, env, sql) {
  try {
    await scalar(stack, toolchain, env, sql);
    return true;
  } catch {
    return false;
  }
}

async function sqlFails(stack, toolchain, env, sql) {
  return !(await sqlSucceeds(stack, toolchain, env, sql));
}

const expectedViewColumns = {
  published_specialists: ['additional_category_ids','avatar_path','category_id','category_name','category_slug','city','country','experience_years','full_description','full_name','help_topics','id','profile_summary','published_at','service_mode','slug','specialization','work_offers'],
  published_reviews: ['body','created_at','id','specialist_id','would_hire_again'],
  published_specialist_verification_facts: ['checked_at','education_checked','experience_checked','identity_checked','qualifications_checked','references_checked','sources_checked','specialist_id'],
  published_specialist_trust_badges: ['assigned_at','badge_id','id','source','specialist_id'],
};

function exactKeys(row, expected) {
  return JSON.stringify(Object.keys(row ?? {}).sort()) === JSON.stringify([...expected].sort());
}

async function defaultPrivilegeProbe(stack, toolchain, env, creator, suffix) {
  const relation = `p009_relation_${suffix}`;
  const sequence = `p009_sequence_${suffix}`;
  const fn = `p009_function_${suffix}`;
  const setRole = creator === 'supabase_admin' ? '' : `set local role ${creator};`;
  return sqlSucceeds(stack, toolchain, env, `
    begin;
    ${setRole}
    create table public.${relation}(id bigint);
    create sequence public.${sequence};
    create function public.${fn}() returns boolean language sql as 'select true';
    do $probe$ begin
      if has_table_privilege('anon','public.${relation}','SELECT,INSERT,UPDATE,DELETE')
         or has_table_privilege('authenticated','public.${relation}','SELECT,INSERT,UPDATE,DELETE')
         or has_sequence_privilege('anon','public.${sequence}','USAGE,UPDATE')
         or has_sequence_privilege('authenticated','public.${sequence}','USAGE,UPDATE')
         or has_function_privilege('anon','public.${fn}()','EXECUTE')
         or has_function_privilege('authenticated','public.${fn}()','EXECUTE') then
        raise exception 'unsafe future-object default privileges';
      end if;
    end $probe$;
    rollback;
  `);
}

export async function runP009Cases(recorder, stack, service, users, fixtures, toolchain, env, enableAal2) {
  const anon = createClient(stack.apiUrl, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-ALAMIN-TEST': 'synthetic-local-only' } },
  });
  const anonViewResults = {};
  for (const [view, columns] of Object.entries(expectedViewColumns)) {
    const result = await anon.from(view).select('*').limit(1);
    anonViewResults[view] = !result.error && result.data?.length === 1 && exactKeys(result.data[0], columns);
  }
  const secureModes = Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('published_specialists','published_reviews',
      'published_specialist_verification_facts','published_specialist_trust_badges') and c.relkind='v'
      and coalesce('security_invoker=true'=any(c.reloptions),false)
      and coalesce('security_barrier=true'=any(c.reloptions),false);
  `));
  recorder.record('P009-001', secureModes === 4, `${secureModes}/4 catalog views use the approved invoker/barrier mode`);
  recorder.record('P009-002', Object.values(anonViewResults).every(Boolean), 'four catalog projections preserve exact explicit column contracts');

  const futureColumnAbsent = await sqlSucceeds(stack, toolchain, env, `
    begin;
    alter table public.specialists add column p009_future_private text;
    do $probe$ begin
      if exists (select 1 from information_schema.columns where table_schema='public'
        and table_name='published_specialists' and column_name='p009_future_private') then
        raise exception 'future private column leaked';
      end if;
    end $probe$;
    rollback;
  `);
  recorder.record('P009-003', futureColumnAbsent, 'future private specialist column stayed outside published projections');

  const exposedInternal = Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('sync_account_profile','enqueue_application_email','enqueue_revision_email',
        'enqueue_profile_hidden_email','track_application_status','touch_email_notification',
        'set_updated_at','set_specialist_revision_updated_at','guard_owner_application_update',
        'guard_owner_revision_update','return_owner_changes_to_moderation','sync_published_verified_badge')
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
  `));
  recorder.record('P009-004', exposedInternal === 0, `${exposedInternal} internal or trigger functions remain client-executable`);

  const unsafePath = Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg where cfg like 'search_path=pg_catalog%');
  `));
  recorder.record('P009-005', unsafePath === 0, `${unsafePath} definer functions lack a fixed pg_catalog-first search_path`);

  recorder.record('P009-006', await defaultPrivilegeProbe(stack, toolchain, env, 'supabase_admin', stack.projectId.slice(-6)), 'supabase_admin future relation, sequence and function are default-deny');
  recorder.record('P009-007', await defaultPrivilegeProbe(stack, toolchain, env, 'postgres', `pg_${stack.projectId.slice(-6)}`), 'postgres future relation, sequence and function are default-deny');

  const apiAssertion = (await scalar(stack, toolchain, env, `select to_regprocedure('private.assert_api_surface_manifest_v1()') is not null;`)) === 't';
  const apiManifestPass = apiAssertion && await sqlSucceeds(stack, toolchain, env, `select private.assert_api_surface_manifest_v1();`);
  recorder.record('P009-008', apiManifestPass, 'versioned API-surface manifest matches all public views and client-executable functions');

  const futureAccountPrivilege = (await scalar(stack, toolchain, env, `
    begin; alter table public.account_profiles add column p009_future_security_state text;
    select has_column_privilege('authenticated','public.account_profiles','p009_future_security_state','UPDATE');
    rollback;
  `)).split(/\s+/u).includes('t');
  const accountAssertionExists = (await scalar(stack, toolchain, env, `select to_regprocedure('private.assert_account_profile_contract_v1()') is not null;`)) === 't';
  const accountRegistryBlocks = accountAssertionExists && await sqlFails(stack, toolchain, env, `
    begin; alter table public.account_profiles add column p009_unregistered_identity text;
    select private.assert_account_profile_contract_v1(); rollback;
  `);
  recorder.record('P009-009', !futureAccountPrivilege && accountRegistryBlocks, 'future account identity fields are not owner-writable and fail the contract registry');

  const originalEmail = users.userA.email;
  const changedEmail = `sync-${stack.projectId.slice(-8)}@example.invalid`;
  const changed = await service.auth.admin.updateUserById(users.userA.id, { email: changedEmail, email_confirm: true });
  const mirror = await service.from('account_profiles').select('email').eq('id', users.userA.id).single();
  const restored = await service.auth.admin.updateUserById(users.userA.id, { email: originalEmail, email_confirm: true });
  const mirrorRestored = await service.from('account_profiles').select('email').eq('id', users.userA.id).single();
  recorder.record('P009-010', !changed.error && mirror.data?.email === changedEmail && !restored.error && mirrorRestored.data?.email === originalEmail, 'trusted local Auth change synchronized the mirror and was restored');

  const moderationExists = (await scalar(stack, toolchain, env, `select to_regprocedure('public.read_moderation_applications_v1(integer)') is not null;`)) === 't';
  const ordinaryRead = await users.userA.client.rpc('read_moderation_applications_v1', { p_limit: 20 });
  recorder.record('P009-011', moderationExists && Boolean(ordinaryRead.error), 'ordinary user denied the exact moderation read contract');
  const moderatorRead = await users.p009Moderator.client.rpc('read_moderation_applications_v1', { p_limit: 20 });
  recorder.record('P009-012', moderationExists && !moderatorRead.error && Array.isArray(moderatorRead.data), 'current AAL1 moderator can use the exact application queue projection');

  const emailReadExists = (await scalar(stack, toolchain, env, `select to_regprocedure('public.admin_read_email_delivery_v1(integer)') is not null;`)) === 't';
  const aal1Email = await users.adminAal1.client.rpc('admin_read_email_delivery_v1', { p_limit: 20 });
  recorder.record('P009-013', emailReadExists && Boolean(aal1Email.error), 'AAL1 administrator denied the sensitive delivery queue projection');
  const aal2 = await enableAal2(users.p009AdminAal2.client, stack);
  const aal2Email = await users.p009AdminAal2.client.rpc('admin_read_email_delivery_v1', { p_limit: 20 });
  const safeEmailShape = !aal2Email.error && Array.isArray(aal2Email.data)
    && (aal2Email.data.length === 0 || !['recipient_email','last_error','subject','template_data'].some((key) => key in aal2Email.data[0]));
  recorder.record('P009-014', aal2.ok && emailReadExists && safeEmailShape, 'real local TOTP AAL2 read returned only minimized delivery metadata', aal2.ok ? null : aal2.reason);

  const revoked = await service.from('moderators').delete().eq('user_id', users.p009Moderator.id);
  const staleRead = await users.p009Moderator.client.rpc('read_moderation_applications_v1', { p_limit: 20 });
  recorder.record('P009-015', !revoked.error && moderationExists && Boolean(staleRead.error), 'role revocation invalidated the privileged read despite a still-valid Auth session');

  const futureViewBlocked = apiAssertion && await sqlFails(stack, toolchain, env, `
    begin; create view public.p009_unregistered_view as select 1::integer as value;
    select private.assert_api_surface_manifest_v1(); rollback;
  `);
  recorder.record('P009-016', futureViewBlocked, 'unregistered future public view fails the API-surface manifest');

  const moderatorDirectQueue = await users.moderator.client.from('email_notifications').select('id').limit(1);
  const adminDirectQueue = await users.adminAal1.client.from('email_notifications').select('id').limit(1);
  recorder.record('P009-017', deniedOrEmpty(moderatorDirectQueue) && deniedOrEmpty(adminDirectQueue), 'AAL1 privileged sessions cannot read the base email queue directly');

  const adminPage = await readFile(join(repoRoot, 'src', 'app', 'admin', 'page.tsx'), 'utf8');
  const sessionRoute = await readFile(join(repoRoot, 'src', 'app', 'api', 'admin', 'session', 'route.ts'), 'utf8');
  recorder.record('P009-018', adminPage.includes('unstable_noStore()') && !adminPage.includes('createSupabaseAdminClient')
    && sessionRoute.includes('private, no-store'), 'privileged reads are dynamic, no-store and avoid service-role page access');
}
