/* @bruin
name: marts.pipeline_freshness
type: duckdb.sql
depends:
  - raw.haxball_snapshots
  - raw.haxball_events
  - marts.player_rankings
materialization:
  type: table
columns:
  - name: metric
    type: string
    checks:
      - name: not_null
      - name: unique
@bruin */

SELECT 'last_snapshot_at' AS metric, cast(max(snapshot_ts) AS VARCHAR) AS value FROM raw.haxball_snapshots
UNION ALL
SELECT 'snapshot_rows', cast(count(*) AS VARCHAR) FROM raw.haxball_snapshots
UNION ALL
SELECT 'event_rows', cast(count(*) AS VARCHAR) FROM raw.haxball_events
UNION ALL
SELECT 'games', cast(count(DISTINCT game_id) AS VARCHAR) FROM raw.haxball_snapshots
UNION ALL
SELECT 'ranked_players', cast(count(*) AS VARCHAR) FROM marts.player_rankings
