/* @bruin
name: marts.team_match_summary
type: duckdb.sql
depends:
  - staging.game_results
  - staging.shots
  - marts.player_game_stats
  - marts.player_rankings
materialization:
  type: table
columns:
  - name: game_id
    type: string
    checks:
      - name: not_null
@bruin */

WITH shot_summary AS (
  SELECT
    game_id,
    team,
    count(*) AS shots,
    round(sum(xg), 3) AS xg
  FROM staging.shots
  GROUP BY 1, 2
),
team_rosters AS (
  SELECT
    p.game_id,
    p.team,
    string_agg(p.player_name, ', ' ORDER BY coalesce(r.impact_score, 0) DESC, p.player_name) AS players,
    count(*) AS player_count,
    round(sum(coalesce(r.impact_score, 0)), 2) AS strength,
    round(avg(coalesce(r.impact_score, 0)), 2) AS avg_strength
  FROM marts.player_game_stats p
  LEFT JOIN marts.player_rankings r ON p.player_name = r.player_name
  WHERE p.team IN ('red', 'blue')
  GROUP BY 1, 2
)
SELECT
  g.game_id,
  g.started_at,
  g.red_score,
  g.blue_score,
  g.winner,
  coalesce(red_roster.players, '') AS red_players,
  coalesce(blue_roster.players, '') AS blue_players,
  coalesce(red_roster.player_count, 0) AS red_player_count,
  coalesce(blue_roster.player_count, 0) AS blue_player_count,
  coalesce(red_roster.strength, 0) AS red_strength,
  coalesce(blue_roster.strength, 0) AS blue_strength,
  round(coalesce(red_roster.strength, 0) - coalesce(blue_roster.strength, 0), 2) AS strength_delta,
  CASE
    WHEN coalesce(red_roster.strength, 0) > coalesce(blue_roster.strength, 0) THEN 'red'
    WHEN coalesce(blue_roster.strength, 0) > coalesce(red_roster.strength, 0) THEN 'blue'
    ELSE 'even'
  END AS strength_favorite,
  coalesce(r.shots, 0) AS red_shots,
  coalesce(b.shots, 0) AS blue_shots,
  coalesce(r.xg, 0) AS red_xg,
  coalesce(b.xg, 0) AS blue_xg,
  CASE
    WHEN coalesce(r.xg, 0) > coalesce(b.xg, 0) THEN 'red'
    WHEN coalesce(b.xg, 0) > coalesce(r.xg, 0) THEN 'blue'
    ELSE 'even'
  END AS xg_winner
FROM staging.game_results g
LEFT JOIN shot_summary r ON g.game_id = r.game_id AND r.team = 1
LEFT JOIN shot_summary b ON g.game_id = b.game_id AND b.team = 2
LEFT JOIN team_rosters red_roster ON g.game_id = red_roster.game_id AND red_roster.team = 'red'
LEFT JOIN team_rosters blue_roster ON g.game_id = blue_roster.game_id AND blue_roster.team = 'blue'
