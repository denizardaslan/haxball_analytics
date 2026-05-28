/* @bruin
name: staging.shots
type: duckdb.sql
depends:
  - raw.haxball_events
materialization:
  type: table
columns:
  - name: game_id
    type: string
    checks:
      - name: not_null
  - name: xg
    type: double
custom_checks:
  - name: staged shot xg stays in range
    query: SELECT count(*) = 0 FROM staging.shots WHERE xg < 0 OR xg > 1
    value: 1
@bruin */

SELECT
  event_id,
  game_id,
  event_ts,
  player_id,
  player_name,
  team,
  ball_x,
  ball_y,
  ball_speed_x,
  ball_speed_y,
  shot_id,
  shot_result,
  distance_to_goal,
  angle_to_goal,
  xg
FROM raw.haxball_events
WHERE event_type = 'kick'
  AND xg IS NOT NULL
  AND xg > 0
  AND (
    is_shot = true
    OR (
      team IN (1, 2)
      AND sqrt((ball_speed_x * ball_speed_x) + (ball_speed_y * ball_speed_y)) >= 6
      AND abs(ball_speed_x) / nullif(sqrt((ball_speed_x * ball_speed_x) + (ball_speed_y * ball_speed_y)), 0) >= 0.4
      AND (
        (team = 1 AND ball_x >= 0 AND ball_speed_x > 0 AND abs(370 - ball_x) <= 260)
        OR (team = 2 AND ball_x <= 0 AND ball_speed_x < 0 AND abs(-370 - ball_x) <= 260)
      )
      AND (
        ball_y + ball_speed_y * (
          CASE WHEN team = 1 THEN (370 - ball_x) ELSE (-370 - ball_x) END
        ) / nullif(ball_speed_x, 0)
      ) BETWEEN -106 AND 106
    )
  )
