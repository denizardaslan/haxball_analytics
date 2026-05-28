/* @bruin
name: marts.player_game_stats
type: duckdb.sql
depends:
  - staging.snapshot_players
  - raw.haxball_events
  - staging.shots
  - staging.game_results
materialization:
  type: table
columns:
  - name: game_id
    type: string
    checks:
      - name: not_null
  - name: player_name
    type: string
    checks:
      - name: not_null
@bruin */

WITH player_base AS (
  SELECT
    game_id,
    player_id,
    player_name,
    last(team ORDER BY snapshot_ts) AS team,
    count(*) * 0.5 AS play_time_seconds,
    avg(x) AS avg_x,
    avg(y) AS avg_y
  FROM staging.snapshot_players
  GROUP BY 1, 2, 3
),
goals AS (
  SELECT
    game_id,
    player_id,
    player_name,
    count(*) AS goals
  FROM raw.haxball_events
  WHERE event_type = 'goal' AND player_id IS NOT NULL
  GROUP BY 1, 2, 3
),
shots AS (
  SELECT
    game_id,
    player_id,
    count(*) AS shots,
    sum(xg) AS total_xg
  FROM staging.shots
  GROUP BY 1, 2
)
SELECT
  b.game_id,
  b.player_id,
  b.player_name,
  CASE b.team WHEN 1 THEN 'red' WHEN 2 THEN 'blue' ELSE 'spectator' END AS team,
  b.play_time_seconds,
  b.avg_x,
  b.avg_y,
  coalesce(g.goals, 0) AS goals,
  coalesce(s.shots, 0) AS shots,
  round(coalesce(s.total_xg, 0), 3) AS total_xg,
  CASE
    WHEN gr.winner = 'draw' THEN 'D'
    WHEN gr.winner = CASE b.team WHEN 1 THEN 'red' WHEN 2 THEN 'blue' ELSE 'spectator' END THEN 'W'
    ELSE 'L'
  END AS result
FROM player_base b
LEFT JOIN goals g ON b.game_id = g.game_id AND b.player_id = g.player_id
LEFT JOIN shots s ON b.game_id = s.game_id AND b.player_id = s.player_id
LEFT JOIN staging.game_results gr ON b.game_id = gr.game_id
