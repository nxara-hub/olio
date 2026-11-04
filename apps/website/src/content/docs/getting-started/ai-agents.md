---
title: AI agents
description: Give a coding agent what it needs to build with olio.
sidebar:
  order: 2
---

olio is newer than most models' training data, so a coding agent needs the docs in front of it. There are three ways to give it them.

## The docs as one file

Point the agent at:

- [`/llms-full.txt`](https://olio.nxara.dev/llms-full.txt): every page, as one Markdown file.
- [`/llms-small.txt`](https://olio.nxara.dev/llms-small.txt): the same, with notes and asides left out.
- [`/llms.txt`](https://olio.nxara.dev/llms.txt): the index, following [llmstxt.org](https://llmstxt.org).

## The skill

An [Agent Skill](https://agentskills.io) teaches the agent olio's layout, setup and rules, and what its errors mean. It loads only when the agent works on an olio app. Install it into your agents with the [`skills`](https://skills.sh) CLI:

```sh
npx skills add nxara-hub/olio
```

Or copy [`skills/olio/SKILL.md`](https://github.com/nxara-hub/olio/blob/main/skills/olio/SKILL.md) into your agent's skills folder, such as `.claude/skills/olio/` for Claude Code.

## The types

The packages ship their doc comments, so an agent reading `node_modules/@nxara/*/dist/*.d.ts` sees the same notes your editor shows on hover. Error messages name the problem and where it is, such as `'User.name' is not declared by posts module` or `No files match "<path>"`, so an agent can usually fix them from the message alone.
