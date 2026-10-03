-- Unhide the staged historical import (run only after the app version with the
-- History toggle is live). Staged rows carry deleted_at <> null and
-- extra.staged = true; this clears both. Rows keep extra.historical = true, so
-- the app still hides them unless the History toggle is on. Safe to re-run.
do $act$
declare t text; n integer;
begin
  foreach t in array array['students','employees','invoices','payslips','expenses','payments'] loop
    execute format($f$update public.%I set deleted_at = null, extra = extra - 'staged' where extra->>'staged' = 'true'$f$, t);
    get diagnostics n = row_count;
    raise notice '% rows activated in %', n, t;
  end loop;
end $act$;
