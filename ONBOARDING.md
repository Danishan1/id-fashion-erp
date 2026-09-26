# Welcome to Fashion ERP

## How We Use Claude

Based on Indradhar Team's usage over the last 30 days:

Work Type Breakdown:
  Build Feature     █████████████████░░░  85%
  Debug Fix         ███░░░░░░░░░░░░░░░░░  15%

Top Skills & Commands:
  /agents                ████████████████████  1x/month
  /compact               ████████████████████  1x/month
  /run-skill-generator   ████████████████████  1x/month

Top MCP Servers:
  Claude Browser     ████████████████████  1595 calls
  ccd_session        █░░░░░░░░░░░░░░░░░░░  5 calls
  ccd_session_mgmt   █░░░░░░░░░░░░░░░░░░░  2 calls
  Gmail              █░░░░░░░░░░░░░░░░░░░  1 call

## Your Setup Checklist

### Codebases
- [ ] fashion-erp — https://github.com/TeamsIndradhar/fashion-erp.git (this repo — the main garment-manufacturing ERP)
- [ ] inventory — git@github.com:TeamsIndradhar/inventory.git (sibling reference project — legacy PHP/Laravel Inventory app; domain patterns are mined from here, not migrated as code)
- [ ] royal_jeans — git@github.com:TeamsIndradhar/royal_jeans.git (sibling reference project — legacy PHP/Laravel denim production system; same "mine the domain, don't port the code" role)
- [ ] virtual-ceo — git@github.com:TeamsIndradhar/virtual-ceo.git (separate project, present in the same workspace)

### MCP Servers to Activate
- [ ] Claude Browser — drives an in-app browser to click through the running app and verify features end-to-end (login, create a record, check a report) instead of guessing from code alone. Already available in Claude Code by default — no setup needed.
- [ ] Gmail MCP — connects Claude to a Gmail account for reading/sending email from a session. Add it under MCP servers in Claude Code settings pointing at `https://gmailmcp.googleapis.com/mcp/v1` and complete the OAuth consent when prompted.

### Skills to Know About
- `/agents` — create or configure a specialized subagent (e.g. a project-testing agent) for repeatable tasks.
- `/compact` — compress the current conversation to free up context on a long session.
- `/run-skill-generator` — scaffold a new custom skill for the team.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
