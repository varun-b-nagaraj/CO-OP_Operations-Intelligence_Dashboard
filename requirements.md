# Executive Dashboard Requirements

## 1. Product Goal
The Executive Dashboard is a single cross-department command center for leadership. It must aggregate major updates from HR, Employee, Product, Inventory, Marketing, Finance, and CFA modules into one place, with an AI assistant as the default entry point.

## 2. Core Principle
The opening experience must be **AI-first**:
- The first page users see is the Executive Dashboard.
- The default active tab is an AI agent chat interface.
- The chat behaves as an MCP-style client for executive analysis.

## 3. Required Pages and Tabs
The Executive Dashboard must include:
1. AI Agent
2. Overview
3. Department Feed
4. Alerts & Exceptions
5. Metrics & Trends
6. Reports Center
7. Calendar

## 4. AI Agent Tab Requirements
### 4.1 UI
- Clean internal-tool chat UI.
- Welcome panel with quick prompts.
- Conversation history in the center panel.
- Prompt composer with send/reset actions.
- Department shortcut links.

### 4.2 MCP Client Behavior
- Accept executive questions in natural language.
- Run MCP-style tools against internal data.
- Return final answer with evidence-backed summary.
- Preserve conversational context across turns.

### 4.3 Tool Activity Visibility (Required)
When tools run, the UI must show readable activity labels, such as:
- Fetching HR info...
- Parsing attendance trends...
- Checking product order updates...
- Reading finance report metadata...
- Reviewing inventory session output...

Each tool activity item must include status:
- `pending`
- `running`
- `complete`
- `failed`

### 4.4 Assistant Prompt Examples
- “What changed this week across all departments?”
- “Show attendance risks and pending HR issues.”
- “List new product orders and anything delayed.”
- “Summarize recent shift results and CFA updates.”
- “What needs executive attention today?”

## 5. Overview Tab Requirements
The Overview tab must include:
- Executive brief (narrative summary)
- Summary KPI cards
- Department health snapshots
- Quick signal cards by risk level

Sample cards:
- New product orders (7d)
- Attendance reliability
- Open HR requests
- Recent finance reports
- Inventory session activity
- Upcoming marketing events
- Recent CFA logs
- Upcoming calendar items

## 6. Department Feed Requirements
A unified event stream across departments with:
- Department label
- Event title
- Event details
- Timestamp
- Severity
- Link to source module

Feed examples:
- New purchase orders
- Finance report uploads
- Inventory session updates
- Marketing event changes
- HR request status changes

## 7. Alerts & Exceptions Requirements
Must surface executive attention items with:
- Department
- Severity (`medium`/`high`)
- Description
- Recommended next action

Alert categories:
- Attendance decline
- Open order backlog
- Finance validation failures
- Inventory anomalies
- Calendar conflict risks

## 8. Metrics & Trends Requirements
High-level trend snapshots (not replacing module-level analytics), including:
- Attendance reliability
- Order throughput and backlog
- Finance reporting throughput
- Calendar load and collision risk

## 9. Reports Center Requirements
Consolidated cross-module report listing with:
- Report type
- Title
- Status
- Last update timestamp
- Owner
- Source module deep link

## 10. Calendar Requirements
Use the shared general-department calendar model. Provide executive-level read and filter capability over cross-department events and deadlines.

## 11. Data Sources
Data is aggregated from existing Supabase-backed modules:
- HR (`hr_*` attendance/requests/strikes)
- Employee-facing operational tables
- Product purchasing tables
- Inventory session tables
- Marketing event/report tables
- Finance report tables
- CFA logs
- Shared calendar events

## 12. API Requirements
### 12.1 Required Internal Endpoints
- `GET /api/executive/overview`
- `POST /api/executive/chat`
- `POST /api/backend/shared/ollama/chat` (proxy)

### 12.2 Strict Proxy Policy (Required)
No direct browser calls to external endpoints are allowed.
All LLM/external traffic must pass through internal backend route handlers.

## 13. Ollama Integration Requirements
The executive chat stack uses Ollama through internal proxy routes.

Environment variables:
```env
OLLAMA_BASE_URL=http://ollama.com
OLLAMA_MODEL=deepseek-v3.1:671b-cloud
OLLAMA_API_KEY=3b987dc5dc6e4dcab20093c1097718a8.v50nmatpJDVAM-U2qQBmjA96
MCP_SERVER_BASE_URL=http://localhost:8081
EXECUTIVE_AI_ENABLED=true
EXECUTIVE_TOOL_STATUS_STREAMING=true
EXECUTIVE_MAX_TOOL_CALLS=8
```

## 14. UX and Quality Requirements
- Fast first load and clear empty states.
- Fully responsive desktop/mobile layout.
- No hidden failures: if a tool fails, show a readable error state.
- Keep language concise and operational.
- Maintain visual consistency with existing dashboard shell.

## 15. Launch Acceptance Criteria
1. Visiting `/` routes users to the Executive Dashboard.
2. AI Agent tab is the default first view.
3. AI chat calls internal `/api/executive/chat` only.
4. `/api/executive/chat` uses internal Ollama proxy endpoint.
5. Tool activity messages are visible during and after calls.
6. Overview/feed/alerts/metrics/reports/calendar tabs render from aggregated data.
7. Each feed/report entry links back to its source module.
8. Configuration supports env-driven Ollama model/base URL/API key.
