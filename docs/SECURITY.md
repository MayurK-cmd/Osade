# Security policy

> Replaced 2026-09-04. This file previously contained Microsoft's `SECURITY.md` block,
> inherited when Osade was planned as a Code-OSS fork. It directed Osade vulnerability reports
> to Microsoft.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately through GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository: **Security → Report a vulnerability**.

Please include: what you were running, the steps to reproduce, and what an attacker gains.

**If that button is not there**, open a public issue that says only that you have a security
report and asks a maintainer to open a private channel — no details, no reproduction, no
proof-of-concept. An empty issue costs a maintainer a minute; a public reproduction costs every
user of the release until it is patched.

No email address is published here on purpose. A private advisory keeps the report, the fix and
the disclosure in one place, and an address in a public file mostly collects spam.

## Scope

Osade is a **local-first, single-user desktop application**. There is no hosted service and no
Osade server to attack. That shapes what counts as a vulnerability here.

In scope:

- Anything reachable off `127.0.0.1`. The daemon must bind loopback only
  (`docs/OSADE.md` §2.1); a listener on `0.0.0.0` is a vulnerability.
- Credential exposure. GitHub tokens and model API keys live in Electron `safeStorage` and are
  passed to the daemon in memory. A token reaching a config file, a log, a crash report, or
  the filesystem is a vulnerability.
- **Gate bypass.** Every write that leaves the machine — push, PR, comment, review — requires
  human approval (`docs/OSADE.md` §14). Any path that performs one of these without an
  approved, hash-matched `gate_request` is a vulnerability, and the most serious class of one
  in this project.
- Agent escape from its worktree, or an agent obtaining credentials the reviewer gateway is
  meant to withhold (`docs/OSADE.md` §16).
- Prompt injection from repository content — an issue body, a README, a PR comment — that
  causes an agent to take a gated action or exfiltrate data. Osade's threat model assumes
  repository content is untrusted.
- Local privilege escalation through Osade's own sockets, worktrees, or `~/.osade/`.

Out of scope:

- Vulnerabilities in the coding agents themselves (Claude Code, Codex, and others). Report
  those to their vendors.
- **The substrate.** Osade vendors it but does not maintain it — report to
  the upstream project listed in `docs/THIRD-PARTY-NOTICES.md`. If a substrate issue is exploitable *through* Osade
  specifically, tell us too so we can pin or mitigate.
- An agent writing bad code inside its own worktree. That is what verification and review are
  for.
- Attacks requiring an attacker who already has local access as the same user.

## Supported versions

Osade is pre-release (`docs/OSADE.md` §21). There are no supported versions and no security
backports yet. This section gets rewritten at the first tagged release.
