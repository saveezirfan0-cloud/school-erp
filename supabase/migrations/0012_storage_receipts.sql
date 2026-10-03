-- ============================================================
-- 0012  Storage policies for the `receipts` bucket
--       *** APPLY TOGETHER WITH THE storage.js CHANGE (see App impact) ***
-- ------------------------------------------------------------
-- Audit: SEC-10.
-- Depends on : 0001, 0002; the `storage` schema (Supabase)
-- Idempotent : yes
-- Data change: bucket settings only (size limit, allowed types). No object is
--              touched.
-- App impact : uploads must use the path  <branch>/<random>.<ext>  where
--              <branch> is the user's branch id, or the word `main` for the
--              main office (users with all-branch visibility may use any
--              folder). File names must end in .jpg .jpeg .png .webp or .pdf.
--              The current src/lib/storage.js uploads to the bucket root with
--              `${Date.now()}_${file.name}`: with this file applied that upload
--              is REFUSED until storage.js builds `${branchKey}/${uuid}.${ext}`.
--              Public URLs of the objects already stored keep working while the
--              bucket stays public.
-- Rollback   : drop policy receipts_insert/receipts_select/receipts_delete on
--              storage.objects;  update storage.buckets set file_size_limit = null,
--              allowed_mime_types = null where id = 'receipts';
--
-- What the policies enforce
--   INSERT  signed-in users with canEditFees or canEditExpenses; bucket
--           'receipts'; one folder level that matches the user's branch;
--           allowed extension. The bucket itself limits size to 5 MB and
--           MIME type to jpeg / png / webp / pdf (checked by Storage).
--   SELECT  same branch rule for users who can view fees or expenses (this
--           governs the API, list() and signed URLs).
--   DELETE  admin only. There is NO update policy, so objects cannot be
--           overwritten.
--
-- !! If the bucket is PUBLIC, anyone with an object URL can read it with no
-- login at all, whatever the SELECT policy says. See the optional step at the
-- bottom to make it private (needs signed URLs in the app).
-- !! Policies created by hand in the dashboard on storage.objects stay in
-- force and are OR-ed with these. This file lists them in its output (step
-- 'existing_policy_*'): delete any permissive one (for example "Allow all"
-- on bucket receipts) after reviewing it.
-- ============================================================
begin;
select public._mig_log('0012', '_start', 'info');

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit    = 5242880,                                   -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'receipts';

-- inventory of policies that are not ours (review them)
do $$
declare p record;
begin
  for p in
    select policyname, cmd, roles::text as roles, qual, with_check
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname not in ('receipts_insert','receipts_select','receipts_delete')
  loop
    perform public._mig_log('0012', 'existing_policy_' || p.policyname, 'info',
      format('REVIEW: cmd=%s roles=%s using=%s with_check=%s', p.cmd, p.roles, coalesce(p.qual,'-'), coalesce(p.with_check,'-')));
  end loop;
end $$;

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and ((select public.has_perm('canEditFees')) or (select public.has_perm('canEditExpenses')))
    and array_length(storage.foldername(name), 1) = 1
    and lower(name) ~ '\.(jpe?g|png|webp|pdf)$'
    and ((select public.sees_all_branches())
         or (storage.foldername(name))[1] = coalesce(nullif((select public.my_branch_key()), ''), 'main'))
  );

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and ((select public.has_perm('canViewFees')) or (select public.has_perm('canViewExpenses')))
    and ((select public.sees_all_branches())
         or (storage.foldername(name))[1] = coalesce(nullif((select public.my_branch_key()), ''), 'main'))
  );

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (select public.is_admin()));

-- ------------------------------------------------------------
-- OPTIONAL LATER STEP (do not run until the app serves receipts through
-- createSignedUrl and stores the object PATH instead of getPublicUrl()):
--
--   update storage.buckets set public = false where id = 'receipts';
--
-- Existing invoices keep the full public URL in extra->>'receiptUrl'; once
-- the bucket is private those links stop working, so convert them to paths
-- first (the object path is everything after '/object/public/receipts/').
-- ------------------------------------------------------------

select public._mig_log('0012', '_done', 'applied');
commit;

select migration, step, status, detail
from public.migration_log
where migration = '0012'
  and at >= (select max(at) from public.migration_log where migration = '0012' and step = '_start')
order by id;
