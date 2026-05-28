/* @bruin
name: marts.player_rankings
type: duckdb.sql
depends:
  - marts.player_game_stats
materialization:
  type: table
columns:
  - name: player_name
    type: string
    checks:
      - name: not_null
      - name: unique
@bruin */

WITH player_totals AS (
  SELECT
    min(player_id) AS player_id,
    player_name,
    count(DISTINCT game_id) AS games_played,
    sum(CASE WHEN result = 'W' THEN 1 ELSE 0 END) AS wins,
    sum(CASE WHEN result = 'L' THEN 1 ELSE 0 END) AS losses,
    sum(CASE WHEN result = 'D' THEN 1 ELSE 0 END) AS draws,
    sum(goals) AS goals,
    sum(shots) AS shots,
    round(sum(total_xg), 3) AS total_xg,
    round(sum(play_time_seconds) / 60, 1) AS minutes_played
  FROM marts.player_game_stats
  GROUP BY player_name
)
SELECT
  row_number() OVER (
    ORDER BY goals DESC, total_xg DESC, wins DESC, games_played DESC
  ) AS rank,
  *,
  round(100.0 * wins / nullif(games_played, 0), 1) AS win_rate,
  round(goals - total_xg, 3) AS xg_overperformance,
  round(goals::DOUBLE / nullif(games_played, 0), 2) AS goals_per_game,
  round(total_xg / nullif(games_played, 0), 2) AS xg_per_game,
  round(shots::DOUBLE / nullif(games_played, 0), 2) AS shots_per_game,
  round(total_xg / nullif(shots, 0), 3) AS xg_per_shot,
  round(100.0 * goals / nullif(greatest(shots, goals), 0), 1) AS shot_conversion_rate,
  round((goals * 3) + total_xg + (wins * 1.5) + (100.0 * wins / nullif(games_played, 0) / 25), 2) AS impact_score
FROM player_totals
