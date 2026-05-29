# Clockify MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes the [Clockify](https://clockify.me/developers-api) REST and Reports APIs to LLM clients (Claude Desktop, Claude Code, Cursor, etc).

## Tools

| Tool | Purpose |
|---|---|
| `clockify_list_workspaces` | List every workspace the API key can see |
| `clockify_get_current_user` | Get your own profile + active workspace |
| `clockify_list_workspace_users` | List/filter users on a workspace |
| `clockify_list_clients` / `clockify_get_client` / `clockify_create_client` / `clockify_update_client` / `clockify_delete_client` | Client CRUD |
| `clockify_list_projects` / `clockify_get_project` / `clockify_create_project` / `clockify_update_project` / `clockify_delete_project` | Project CRUD |
| `clockify_list_tasks` / `clockify_get_task` / `clockify_create_task` / `clockify_update_task` / `clockify_delete_task` | Task CRUD |
| `clockify_list_tags` / `clockify_get_tag` / `clockify_create_tag` / `clockify_update_tag` / `clockify_delete_tag` | Tag CRUD |
| `clockify_list_time_entries` | List a user's time entries with filters |
| `clockify_get_time_entry` | Get one time entry by ID |
| `clockify_list_in_progress_entries` | Currently running entries across the workspace |
| `clockify_start_time_entry` | Start a timer or log a past entry |
| `clockify_update_time_entry` | Edit a time entry |
| `clockify_stop_running_timer` | Stop the user's active timer |
| `clockify_delete_time_entry` | Delete a time entry |
| `clockify_detailed_report` | Detailed report (one row per entry) |
| `clockify_summary_report` | Summary report grouped by 1-2 dimensions |
| `clockify_weekly_report` | Weekly timesheet report |

All list tools support pagination (`page`, `page_size`) and a `response_format` of `markdown` or `json`.

## Installation

```bash
npm install
npm run build
```

## Configuration

The server requires a Clockify API key. Get one from **Clockify → Profile Settings → API**.

Set environment variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CLOCKIFY_API_KEY` | yes | — | Your X-Api-Key |
| `CLOCKIFY_API_BASE_URL` | no | `https://api.clockify.me/api/v1` | Override for regional servers (`euc1`, `use2`, `euw2`, `apse2`) or subdomain workspaces |
| `CLOCKIFY_REPORTS_BASE_URL` | no | `https://reports.api.clockify.me/v1` | Reports API base |

## Claude Desktop config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clockify": {
      "command": "node",
      "args": ["/absolute/path/to/clockify-mcp-server/dist/index.js"],
      "env": {
        "CLOCKIFY_API_KEY": "your_clockify_api_key_here"
      }
    }
  }
}
```

For regional workspaces (EU/US/UK/AU), add `CLOCKIFY_API_BASE_URL` and `CLOCKIFY_REPORTS_BASE_URL` accordingly.

## Local testing

```bash
export CLOCKIFY_API_KEY=your_key
npx @modelcontextprotocol/inspector node dist/index.js
```

## Examples

A few prompts the model can fulfil end-to-end:

- *"How many hours did I log on the 'Phoenix' project in March 2026?"* — `get_current_user` → `list_projects` (filter name="Phoenix") → `detailed_report` (project filter + date window).
- *"Who's currently tracking time right now?"* — `list_workspaces` → `list_in_progress_entries`.
- *"Create a 'Design review' task on the Phoenix project and start a timer for it."* — `list_projects` → `create_task` → `start_time_entry`.

## Notes

- All ISO-8601 datetimes must include the `Z` UTC suffix. The schemas enforce this.
- Reports endpoints can be slow for wide date ranges — narrow `dateRangeStart`/`dateRangeEnd` if you hit timeouts.
- Clockify rate-limits per API key. The error handler surfaces 429s with a hint to back off.
