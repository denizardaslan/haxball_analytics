/* @bruin
name: raw.haxball_events
type: duckdb.sql
depends:
  - haxball.prepare_inputs
materialization:
  type: table
columns:
  - name: event_id
    type: string
    checks:
      - name: not_null
      - name: unique
  - name: game_id
    type: string
    checks:
      - name: not_null
  - name: event_type
    type: string
    checks:
      - name: not_null
      - name: accepted_values
        value: [goal, kick, join, leave, gameStart, gameStop]
custom_checks:
  - name: xg stays in probability range
    query: |
      SELECT count(*) = 0
      FROM raw.haxball_events
      WHERE xg IS NOT NULL AND (xg < 0 OR xg > 1)
    value: 1
  - name: team values are valid
    query: |
      SELECT count(*) = 0
      FROM raw.haxball_events
      WHERE team IS NOT NULL AND team NOT IN (0, 1, 2)
    value: 1
@bruin */

SELECT
  eventId AS event_id,
  gameId AS game_id,
  CAST(timestamp AS TIMESTAMP) AS event_ts,
  eventType AS event_type,
  playerId AS player_id,
  playerName AS player_name,
  team,
  position.x AS player_x,
  position.y AS player_y,
  ballPosition.x AS ball_x,
  ballPosition.y AS ball_y,
  ballSpeed.speedX AS ball_speed_x,
  ballSpeed.speedY AS ball_speed_y,
  coalesce(CAST(json_extract(metadata, '$.isShot') AS BOOLEAN), false) AS is_shot,
  json_extract_string(metadata, '$.shotId') AS shot_id,
  json_extract_string(metadata, '$.shotResult') AS shot_result,
  CAST(json_extract(metadata, '$.distanceToGoal') AS DOUBLE) AS distance_to_goal,
  CAST(json_extract(metadata, '$.angleToGoal') AS DOUBLE) AS angle_to_goal,
  xg
FROM read_json(
  'data/bruin_input/events.jsonl',
  columns = {
    eventId: 'VARCHAR',
    gameId: 'VARCHAR',
    timestamp: 'VARCHAR',
    eventType: 'VARCHAR',
    playerId: 'BIGINT',
    playerName: 'VARCHAR',
    team: 'BIGINT',
    position: 'STRUCT(x DOUBLE, y DOUBLE)',
    ballPosition: 'STRUCT(x DOUBLE, y DOUBLE)',
    ballSpeed: 'STRUCT(speedX DOUBLE, speedY DOUBLE)',
    metadata: 'JSON',
    xg: 'DOUBLE'
  }
)
