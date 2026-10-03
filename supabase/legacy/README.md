# Legacy one-off scripts: do not run

`fix_duplicate_accounts.sql` and `fix_duplicate_branches.sql` were one-off data
repairs. They are kept for history only. **Do not run them.**

Problems found in the database audit (DB-8):

- `fix_duplicate_branches.sql` hard-deletes branches, forgets `users.branch_id`,
  can pick a trashed branch as the keeper, and adds a case-sensitive unique
  constraint that also covers trashed rows.
- `fix_duplicate_accounts.sql` needs `trash.sql` first, only merges exact
  `(code, name)` pairs and adds no constraint, so duplicates return on the next
  import.

They are replaced by `supabase/migrations/0004_dedupe_branches_accounts.sql`
(soft, reversible, live rows only, case-insensitive, repoints users, logs
anything it cannot decide) and the partial unique indexes in
`0005_columns_defaults_constraints.sql`.
