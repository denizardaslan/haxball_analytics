/* @bruin
name: raw.haxball_snapshots
type: duckdb.sql
depends:
  - haxball.prepare_inputs
materialization:
  type: table
columns:
  - name: game_id
    type: string
    checks:
      - name: not_null
  - name: snapshot_ts
    type: timestamp
    checks:
      - name: not_null
  - name: tick_number
    type: integer
  - name: game_time
    type: double
  - name: red_score
    type: integer
  - name: blue_score
    type: integer
custom_checks:
  - name: snapshot coordinates stay inside classic stadium
    query: |
      SELECT count(*) = 0
      FROM raw.haxball_snapshots
      WHERE ball_x IS NOT NULL
        AND (ball_x < -400 OR ball_x > 400 OR ball_y < -170 OR ball_y > 170)
    value: 1
  - name: snapshot gaps stay near collection interval
    query: |
      WITH ordered AS (
        SELECT game_id, snapshot_ts, lag(snapshot_ts) OVER (PARTITION BY game_id ORDER BY snapshot_ts) AS prev_ts
        FROM raw.haxball_snapshots
      )
      SELECT count(*) = 0
      FROM ordered
      WHERE prev_ts IS NOT NULL
        AND date_diff('second', prev_ts, snapshot_ts) > 2
    value: 1
@bruin */

SELECT
  gameId AS game_id,
  CAST(timestamp AS TIMESTAMP) AS snapshot_ts,
  tickNumber AS tick_number,
  gameTime AS game_time,
  score.red AS red_score,
  score.blue AS blue_score,
  ball.x AS ball_x,
  ball.y AS ball_y,
  ball.speedX AS ball_speed_x,
  ball.speedY AS ball_speed_y,
  players
FROM read_json(
  'data/bruin_input/snapshots.jsonl',
  columns = {
    gameId: 'VARCHAR',
    timestamp: 'VARCHAR',
    tickNumber: 'BIGINT',
    gameTime: 'DOUBLE',
    score: 'STRUCT(red BIGINT, blue BIGINT)',
    ball: 'STRUCT(x DOUBLE, y DOUBLE, speedX DOUBLE, speedY DOUBLE)',
    players: 'STRUCT(id BIGINT, name VARCHAR, team BIGINT, x DOUBLE, y DOUBLE, speedX DOUBLE, speedY DOUBLE)[]'
  }
)
