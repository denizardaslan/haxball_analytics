/* @bruin
name: marts.xg_overperformance
type: duckdb.sql
depends:
  - marts.player_rankings
materialization:
  type: table
columns:
  - name: player_name
    type: string
    checks:
      - name: not_null
@bruin */

SELECT
  rank,
  player_name,
  games_played,
  goals,
  shots,
  total_xg,
  xg_overperformance,
  CASE
    WHEN xg_overperformance >= 1 THEN 'clinical finisher'
    WHEN xg_overperformance <= -1 THEN 'chance generator'
    WHEN total_xg >= 1 THEN 'balanced attacker'
    ELSE 'small sample'
  END AS profile
FROM marts.player_rankings
ORDER BY xg_overperformance DESC, goals DESC
