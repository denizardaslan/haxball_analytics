# Haxball Analytics

Bruin-powered analytics for a live Haxball room. The project turns multiplayer game telemetry into a validated sports analytics warehouse and a real-time dashboard.

## Why This Exists

Most analytics demos start from a static dataset. This one creates the dataset live: a 24/7 Haxball room captures player positions, ball movement, kicks, goals, xG, possession, and heatmap data. Bruin CLI then turns those raw events into tested DuckDB marts for ranking players and explaining matches.

## Architecture

```text
Live Haxball room
  -> Node.js collector
  -> JSONL snapshots/events
  -> Bruin CLI pipeline
  -> DuckDB analytics tables
  -> Custom HTML dashboard
```

## Bruin CLI Showcase

The Bruin project lives in `bruin/` and is the analytics brain of the repo.

```bash
bruin validate bruin
bruin run bruin
```

The pipeline:

- prepares live or sample JSONL inputs,
- ingests raw snapshots and events,
- flattens player positions,
- builds match, player, xG, heatmap, and freshness marts,
- runs domain quality checks for event IDs, team values, xG ranges, field coordinates, snapshot gaps, and score consistency.

## Quick Start

### 1. Install dependencies

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Install Bruin CLI if needed:

```bash
curl -LsSf https://getbruin.com/install/cli | sh
```

### 2. Configure the room

```bash
cp .env.example .env
```

Add a token from <https://www.haxball.com/headlesstoken>.

### 3. Build analytics from sample data

```bash
npm run bruin:validate
npm run bruin:run
```

This creates `data/haxball_analytics.duckdb` from committed demo games, so the dashboard works before a live room is running.

### 4. Run the dashboard demo

```bash
npm run demo
```

Open <http://localhost:3000/live.html>.

### 5. Run the live room

```bash
npm run dev
```

The same dashboard URL will switch from sample analytics to live match updates as the room runs.

## Dashboard Views

- **Live Match**: WebSocket-powered pitch, score, xG, and event feed.
- **Players**: Bruin-built player rankings from DuckDB.
- **Matches**: match history with score and xG winner.
- **xG**: finishing overperformance and player profiles.
- **Heatmaps**: team territory grid from player snapshots.
- **Pipeline**: Bruin freshness metrics surfaced in the product UI.

## Live Data Flow

During real matches, Node writes JSONL files into `data/snapshots/` and `data/events/`. The Bruin prepare asset prefers those live files when present. If no live files exist, it falls back to `sample_data/`.

Run this after games or on a VPS cron:

```bash
npm run bruin:run
```

## VPS Deployment Notes

Recommended minimal Hetzner setup:

```bash
sudo apt update
sudo apt install -y curl git python3-pip
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -LsSf https://getbruin.com/install/cli | sh
```

Then clone the repo, install dependencies, set `.env`, and run the room with a process manager such as `pm2` or `systemd`. Schedule Bruin every few minutes:

```cron
*/5 * * * * cd /path/to/haxball_analytics && /path/to/bruin run bruin
```

## Competition Screenshot Checklist

- Bruin CLI `bruin validate bruin` passing.
- Bruin CLI `bruin run bruin` building DuckDB tables.
- Bruin asset graph / lineage from the VS Code extension.
- Dashboard Live Match tab.
- Dashboard Players and xG tabs populated from Bruin marts.
- Dashboard Pipeline tab showing freshness metrics.
- Bruin AI analysis screenshots asking questions about xG overperformance and upset matches.

## Tech Stack

- Node.js + TypeScript
- Haxball Headless via `haxball.js`
- Express + WebSocket
- Bruin CLI
- DuckDB
- Vanilla HTML/CSS/JS dashboard
