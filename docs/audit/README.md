# Audit workspace

Each audit agent writes one report to `docs/audit/<agent-name>.md`.
`/audit` then merges them into `docs/audit/SUMMARY.md` (a single prioritized backlog).

## Finding format (all agents must use this)

```
### [ID] Short title
- Severity: Critical | High | Medium | Low | Info
- Effort: S (<1h) | M (<1 day) | L (>1 day)
- Location: path/to/file.ext:LINE (or table/policy name)
- Evidence: what the code actually does (quote the lines)
- Impact: concrete failure or abuse scenario
- Fix: specific change to make
- Verified: yes (reproduced / traced end to end) | no (suspected)
```

IDs: SEC-, DB-, ACC-, CODE-, DEP-, UX-, FEAT- prefixes plus a number.
Only report things you have read the code for. Mark guesses `Verified: no`.

## Agents

| Agent | Question it answers |
|---|---|
| `security-auditor` | Can someone read/change data they shouldn't? |
| `database-auditor` | Is the schema/RLS/migration set correct, consistent, performant? |
| `accounting-auditor` | Is the money right? (fees, payments, payslips, ledger) |
| `code-quality-auditor` | Bugs, dead code, perf, maintainability of the React app |
| `devops-deps-auditor` | Dependencies, build, deploy, CI, tests, backups, env |
| `ux-compliance-auditor` | Accessibility, UX gaps, student-data privacy/compliance |
| `feature-strategist` | What should we build next, and in what order? |

Run all with `/audit`, or one with e.g. "use the security-auditor agent".
