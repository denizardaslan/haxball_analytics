/* @bruin
name: marts.heatmap_cells
type: duckdb.sql
depends:
  - staging.snapshot_players
materialization:
  type: table
columns:
  - name: team
    type: integer
    checks:
      - name: not_null
@bruin */

SELECT
  team,
  greatest(0, least(36, floor((x + 370) / 20)))::INTEGER AS cell_x,
  greatest(0, least(16, floor((y + 170) / 20)))::INTEGER AS cell_y,
  count(*) AS touches,
  round(100.0 * count(*) / max(count(*)) OVER (PARTITION BY team), 2) AS intensity
FROM staging.snapshot_players
GROUP BY 1, 2, 3
