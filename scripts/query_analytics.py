#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any

try:
    import duckdb
except ImportError as exc:
    print(json.dumps({"error": "duckdb Python package is not installed", "detail": str(exc)}))
    sys.exit(1)


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "haxball_analytics.duckdb"


QUERIES = {
    "summary": """
        SELECT
          (SELECT count(*) FROM staging.game_results) AS games,
          (SELECT count(*) FROM marts.player_rankings) AS players,
          (SELECT coalesce(sum(goals), 0) FROM marts.player_rankings) AS goals,
          (SELECT coalesce(round(sum(total_xg), 2), 0) FROM marts.player_rankings) AS xg,
          (SELECT max(started_at) FROM staging.game_results) AS last_game_at
    """,
    "players": """
        SELECT
          rank,
          player_name,
          games_played,
          wins,
          losses,
          draws,
          goals,
          shots,
          total_xg,
          minutes_played,
          win_rate,
          xg_overperformance,
          goals_per_game,
          xg_per_game,
          shots_per_game,
          xg_per_shot,
          shot_conversion_rate,
          impact_score
        FROM marts.player_rankings
        ORDER BY impact_score DESC, rank
    """,
    "matches": """
        SELECT
          game_id,
          started_at,
          red_score,
          blue_score,
          winner,
          red_players,
          blue_players,
          red_player_count,
          blue_player_count,
          red_strength,
          blue_strength,
          strength_delta,
          strength_favorite,
          red_shots,
          blue_shots,
          red_xg,
          blue_xg,
          xg_winner,
          red_shots + blue_shots AS total_shots,
          round(red_xg - blue_xg, 3) AS xg_delta,
          CASE
            WHEN winner <> 'draw' AND xg_winner <> 'even' AND winner <> xg_winner THEN true
            ELSE false
          END AS scoreboard_upset
        FROM marts.team_match_summary
        ORDER BY started_at DESC
        LIMIT 50
    """,
    "lineups": """
        WITH side_rows AS (
          SELECT
            game_id,
            started_at,
            'red' AS side,
            red_players AS lineup,
            red_player_count AS player_count,
            red_strength AS strength,
            blue_strength AS opponent_strength,
            red_score AS goals,
            blue_score AS goals_against,
            red_shots AS shots,
            blue_shots AS shots_against,
            red_xg AS xg,
            blue_xg AS xg_against,
            winner
          FROM marts.team_match_summary
          UNION ALL
          SELECT
            game_id,
            started_at,
            'blue' AS side,
            blue_players AS lineup,
            blue_player_count AS player_count,
            blue_strength AS strength,
            red_strength AS opponent_strength,
            blue_score AS goals,
            red_score AS goals_against,
            blue_shots AS shots,
            red_shots AS shots_against,
            blue_xg AS xg,
            red_xg AS xg_against,
            winner
          FROM marts.team_match_summary
        ),
        lineup_rows AS (
          SELECT *
          FROM side_rows
          WHERE lineup IS NOT NULL AND lineup <> ''
        )
        SELECT
          lineup,
          any_value(side) AS last_side,
          count(*) AS games,
          sum(CASE WHEN winner = side THEN 1 ELSE 0 END) AS wins,
          sum(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) AS draws,
          round(avg(strength), 2) AS avg_strength,
          round(avg(strength - opponent_strength), 2) AS avg_strength_edge,
          sum(goals) AS goals,
          sum(goals_against) AS goals_against,
          sum(shots) AS shots,
          sum(shots_against) AS shots_against,
          round(sum(xg), 3) AS xg,
          round(sum(xg_against), 3) AS xg_against,
          round(100.0 * sum(CASE WHEN winner = side THEN 1 ELSE 0 END) / nullif(count(*), 0), 1) AS win_rate,
          round(sum(goals)::DOUBLE / nullif(greatest(sum(shots), sum(goals)), 0), 3) AS conversion_rate,
          round(sum(xg)::DOUBLE / nullif(sum(shots), 0), 3) AS xg_per_shot,
          round(sum(xg) - sum(xg_against), 3) AS xg_diff,
          max(started_at) AS last_seen_at
        FROM lineup_rows
        GROUP BY lineup
        ORDER BY games DESC, win_rate DESC, avg_strength DESC
        LIMIT 50
    """,
    "xg": """
        SELECT
          player_name,
          games_played,
          goals,
          shots,
          total_xg,
          xg_overperformance,
          profile
        FROM marts.xg_overperformance
        ORDER BY xg_overperformance DESC, goals DESC
    """,
    "alltime": """
        WITH seen_players AS (
          SELECT player_name
          FROM staging.snapshot_players
          WHERE player_name IS NOT NULL AND player_name <> ''
          UNION
          SELECT player_name
          FROM raw.haxball_events
          WHERE player_name IS NOT NULL AND player_name <> ''
        ),
        joined_players AS (
          SELECT DISTINCT player_name
          FROM raw.haxball_events
          WHERE event_type = 'join'
            AND player_name IS NOT NULL
            AND player_name <> ''
        )
        SELECT
          (SELECT count(*) FROM staging.game_results) AS tracked_games,
          (SELECT count(*) FROM marts.player_rankings) AS ranked_players,
          (SELECT count(*) FROM seen_players) AS players_seen_in_tracked_data,
          (SELECT count(*) FROM joined_players) AS players_joined_during_tracked_sessions,
          (SELECT count(*) FROM raw.haxball_events WHERE event_type = 'join') AS tracked_join_events,
          (SELECT coalesce(round(sum(minutes_played), 1), 0) FROM marts.player_rankings) AS total_player_minutes,
          (SELECT coalesce(round(sum(duration_seconds) / 60, 1), 0) FROM staging.game_results) AS total_match_minutes,
          (SELECT coalesce(sum(goals), 0) FROM marts.player_rankings) AS total_goals,
          (SELECT coalesce(sum(shots), 0) FROM marts.player_rankings) AS total_shots,
          (SELECT coalesce(round(sum(total_xg), 2), 0) FROM marts.player_rankings) AS total_xg,
          (SELECT count(*) FROM marts.team_match_summary) AS match_cards_available,
          (SELECT count(*) FROM marts.xg_overperformance) AS finishing_profiles,
          (SELECT count(*) FROM (
            SELECT red_players AS lineup FROM marts.team_match_summary WHERE red_players IS NOT NULL AND red_players <> ''
            UNION
            SELECT blue_players AS lineup FROM marts.team_match_summary WHERE blue_players IS NOT NULL AND blue_players <> ''
          ) unique_lineup_rows) AS unique_lineups,
          (SELECT min(started_at) FROM staging.game_results) AS first_tracked_game_at,
          (SELECT max(started_at) FROM staging.game_results) AS last_tracked_game_at,
          (SELECT coalesce(round(avg(duration_seconds), 1), 0) FROM staging.game_results) AS avg_game_seconds,
          (SELECT coalesce(max(goals), 0) FROM marts.player_rankings) AS top_player_goals,
          (SELECT coalesce(max(total_xg), 0) FROM marts.player_rankings) AS top_player_xg
    """,
    "heatmap": """
        SELECT team, cell_x, cell_y, touches, intensity
        FROM marts.heatmap_cells
        ORDER BY team, cell_y, cell_x
    """,
    "pipeline": """
        SELECT metric, value
        FROM marts.pipeline_freshness
        ORDER BY metric
    """,
}


def rows_to_dicts(cursor: duckdb.DuckDBPyConnection, query: str) -> list[dict[str, Any]]:
    result = cursor.execute(query)
    columns = [description[0] for description in result.description]
    rows = result.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def main() -> int:
    endpoint = sys.argv[1] if len(sys.argv) > 1 else "summary"
    if endpoint not in QUERIES:
        print(json.dumps({"error": f"unknown endpoint: {endpoint}"}))
        return 2

    if not DB_PATH.exists():
        print(json.dumps({"ready": False, "error": "DuckDB database does not exist", "path": str(DB_PATH)}))
        return 1

    conn = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        rows = rows_to_dicts(conn, QUERIES[endpoint])
        payload: dict[str, Any] = {"ready": True, "endpoint": endpoint, "rows": rows}
        if endpoint == "pipeline":
            payload["metrics"] = {row["metric"]: row["value"] for row in rows}
        print(json.dumps(payload, default=str))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
