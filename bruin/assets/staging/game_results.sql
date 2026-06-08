/* @bruin
name: staging.game_results
type: duckdb.sql
depends:
  - raw.haxball_snapshots
  - raw.haxball_events
  - staging.snapshot_players
materialization:
  type: table
columns:
  - name: game_id
    type: string
    checks:
      - name: not_null
      - name: unique
custom_checks:
  - name: final score equals goal event count
    query: |
      WITH goal_counts AS (
        SELECT
          game_id,
          sum(CASE WHEN event_type = 'goal' AND team = 1 THEN 1 ELSE 0 END) AS red_goals,
          sum(CASE WHEN event_type = 'goal' AND team = 2 THEN 1 ELSE 0 END) AS blue_goals
        FROM raw.haxball_events
        GROUP BY 1
      )
      SELECT count(*) = 0
      FROM staging.game_results g
      LEFT JOIN goal_counts c USING (game_id)
      WHERE g.red_score <> coalesce(c.red_goals, 0)
         OR g.blue_score <> coalesce(c.blue_goals, 0)
    value: 1
@bruin */

WITH scored_snapshots AS (
  SELECT
    *,
    array_length(players) AS active_player_count
  FROM raw.haxball_snapshots
),
ranked AS (
  SELECT
    *,
    row_number() OVER (PARTITION BY game_id ORDER BY snapshot_ts DESC) AS rn
  FROM scored_snapshots
  WHERE active_player_count >= 2
),
snap_summary AS (
  SELECT
    game_id,
    min(snapshot_ts) AS started_at,
    max(CASE WHEN active_player_count >= 2 THEN snapshot_ts ELSE NULL END) AS ended_at,
    max(CASE WHEN active_player_count >= 2 THEN game_time ELSE NULL END) - min(game_time) AS duration_seconds,
    count(*) AS snapshot_count
  FROM scored_snapshots
  GROUP BY 1
),
players AS (
  SELECT game_id, count(DISTINCT player_id) AS player_count
  FROM staging.snapshot_players
  GROUP BY 1
),
events AS (
  SELECT game_id, count(*) AS event_count
  FROM raw.haxball_events
  GROUP BY 1
)
SELECT
  s.game_id,
  s.started_at,
  s.ended_at,
  s.duration_seconds,
  r.red_score,
  r.blue_score,
  CASE
    WHEN r.red_score > r.blue_score THEN 'red'
    WHEN r.blue_score > r.red_score THEN 'blue'
    ELSE 'draw'
  END AS winner,
  coalesce(p.player_count, 0) AS player_count,
  s.snapshot_count,
  coalesce(e.event_count, 0) AS event_count
FROM snap_summary s
JOIN ranked r ON s.game_id = r.game_id AND r.rn = 1
LEFT JOIN players p ON s.game_id = p.game_id
LEFT JOIN events e ON s.game_id = e.game_id
