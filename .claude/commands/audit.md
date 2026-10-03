---
description: Run the full multi-agent audit (security, database, accounting, code, devops, UX/compliance, features) and merge results
argument-hint: "[agent names to run, default: all]"
---
Run the school-ERP audit.

1. Launch these subagents in parallel (one Agent call each, in a single message, run in the background): `security-auditor`, `database-auditor`, `accounting-auditor`, `code-quality-auditor`, `devops-deps-auditor`, `ux-compliance-auditor`, `feature-strategist`. If `$ARGUMENTS` names specific agents, run only those. Tell each: "Follow docs/audit/README.md. Write your report to docs/audit/<your-name>.md."
2. When all have reported, read every `docs/audit/*.md` report. Spot check the three highest-severity findings by reading the cited code yourself; downgrade or drop any that don't hold.
3. Write `docs/audit/SUMMARY.md`: (a) one-paragraph health verdict, (b) table of Critical/High findings with ID, title, effort, (c) cross-cutting themes (findings repeated by several agents), (d) a prioritized backlog in 3 waves: "this week" (critical security/money), "this month", "later", (e) feature roadmap highlights, (f) things no agent covered.
4. Do not modify application code, and do not commit unless asked. Reply with the verdict, the top 5 items and the SUMMARY path.
