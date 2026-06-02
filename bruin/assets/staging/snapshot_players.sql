/* @bruin
name: staging.snapshot_players
type: duckdb.sql
depends:
  - raw.haxball_snapshots
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
custom_checks:
  - name: player positions stay inside classic stadium
    query: |
      SELECT count(*) = 0
      FROM staging.snapshot_players
      WHERE x < -430 OR x > 430 OR y < -200 OR y > 200
    value: 1
@bruin */

SELECT
  s.game_id,
  s.snapshot_ts,
  s.tick_number,
  s.game_time,
  p.id AS player_id,
  p.name AS player_name,
  p.team,
  p.x,
  p.y,
  p.speedX AS speed_x,
  p.speedY AS speed_y
FROM raw.haxball_snapshots AS s,
LATERAL UNNEST(s.players) AS t(p)
WHERE p.team > 0
