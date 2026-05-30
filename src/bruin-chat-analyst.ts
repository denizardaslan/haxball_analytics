import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_QUESTION_LENGTH = 240;
let queryQueue: Promise<unknown> = Promise.resolve();

type AnalystIntent =
  | 'help'
  | 'summary'
  | 'topPlayers'
  | 'xg'
  | 'lastMatch'
  | 'upsets'
  | 'lineups'
  | 'heatmap'
  | 'pipeline';

interface BruinQueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  connectionName: string;
  query: string;
}

interface IntentDefinition {
  intent: AnalystIntent;
  description: string;
  query?: string;
  format: (result?: BruinQueryResult) => string;
}

export interface BruinChatAnswer {
  intent: AnalystIntent;
  question: string;
  sql: string | null;
  answer: string;
}

function bruinPath(): string {
  return process.env.BRUIN_BIN || path.join(os.homedir(), '.local', 'bin', 'bruin');
}

function cleanQuestion(rawMessage: string): string {
  const withoutCommand = rawMessage.replace(/^!bruin\b/i, '').trim();
  return withoutCommand.replace(/^["']|["']$/g, '').trim().slice(0, MAX_QUESTION_LENGTH);
}

export function isBruinChatCommand(message: string): boolean {
  return /^!bruin(\s|$)/i.test(message.trim());
}

function hasAny(question: string, terms: string[]): boolean {
  return terms.some((term) => question.includes(term));
}

function classifyQuestion(question: string): AnalystIntent {
  const q = question.toLowerCase();

  if (!q || hasAny(q, ['help', 'commands', 'what can'])) {
    return 'help';
  }
  if (hasAny(q, ['pipeline', 'fresh', 'freshness', 'rows', 'data updated', 'status'])) {
    return 'pipeline';
  }
  if (hasAny(q, ['heat', 'heatmap', 'territory', 'where do', 'position'])) {
    return 'heatmap';
  }
  if (hasAny(q, ['lineup', 'duo', 'pair', 'team combo', 'combination'])) {
    return 'lineups';
  }
  if (hasAny(q, ['upset', 'stole', 'lucky', 'xg winner', 'scoreboard'])) {
    return 'upsets';
  }
  if (hasAny(q, ['last match', 'latest match', 'recent match', 'last game', 'latest game'])) {
    return 'lastMatch';
  }
  if (hasAny(q, ['xg', 'expected goal', 'clinical', 'finisher', 'overperform', 'chance'])) {
    return 'xg';
  }
  if (hasAny(q, ['top', 'best', 'rank', 'leader', 'mvp', 'player'])) {
    return 'topPlayers';
  }
  if (hasAny(q, ['summary', 'overall', 'how many', 'total', 'overview'])) {
    return 'summary';
  }

  return 'summary';
}

function cell(row: unknown[], columns: BruinQueryResult['columns'], name: string): unknown {
  const index = columns.findIndex((column) => column.name === name);
  return index >= 0 ? row[index] : null;
}

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }
  return String(value);
}

function safeSql(query: string): string {
  const normalized = query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().toLowerCase();
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|replace|copy|attach|detach|pragma|call)\b/;

  if (!/^(select|with)\b/.test(normalized) || forbidden.test(normalized) || normalized.includes(';')) {
    throw new Error('Unsafe Bruin analyst SQL was blocked.');
  }

  return query;
}

function runBruinQuery(query: string): Promise<BruinQueryResult> {
  const checkedQuery = safeSql(query);

  return new Promise((resolve, reject) => {
    const child = spawn(
      bruinPath(),
      [
        'query',
        '--connection',
        process.env.BRUIN_ANALYST_CONNECTION || 'duckdb-default',
        '--query',
        checkedQuery,
        '--output',
        'json',
        '--limit',
        process.env.BRUIN_ANALYST_LIMIT || '25',
        '--description',
        'Haxball room !bruin chat analyst query',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Bruin query timed out.'));
    }, parseInt(process.env.BRUIN_ANALYST_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Bruin exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as BruinQueryResult);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runQueuedBruinQuery(query: string): Promise<BruinQueryResult> {
  const nextQuery = queryQueue.then(
    () => runBruinQuery(query),
    () => runBruinQuery(query)
  );

  queryQueue = nextQuery.catch(() => undefined);
  return nextQuery;
}

const INTENTS: Record<AnalystIntent, IntentDefinition> = {
  help: {
    intent: 'help',
    description: 'Show supported room-chat analyst questions.',
    format: () =>
      'Ask: !bruin top players | !bruin xg | !bruin last match | !bruin upsets | !bruin lineups | !bruin heatmap | !bruin pipeline',
  },
  summary: {
    intent: 'summary',
    description: 'Overall tracked-game summary.',
    query: `
      SELECT
        count(*) AS games,
        coalesce(sum(red_score + blue_score), 0) AS goals,
        coalesce(round(sum(red_xg + blue_xg), 2), 0) AS xg,
        coalesce(sum(red_shots + blue_shots), 0) AS shots,
        max(started_at) AS last_game_at
      FROM marts.team_match_summary
    `,
    format: (result) => {
      const row = result?.rows[0];
      if (!row || !result) return 'Bruin Analyst: no tracked matches yet.';
      return `Bruin Analyst: ${fmt(cell(row, result.columns, 'games'))} games, ${fmt(cell(row, result.columns, 'goals'))} goals, ${fmt(cell(row, result.columns, 'shots'))} shots, ${fmt(cell(row, result.columns, 'xg'))} xG.`;
    },
  },
  topPlayers: {
    intent: 'topPlayers',
    description: 'Top players by impact score.',
    query: `
      SELECT player_name, impact_score, goals, total_xg, win_rate
      FROM marts.player_rankings
      ORDER BY impact_score DESC, rank
      LIMIT 3
    `,
    format: (result) => {
      if (!result || result.rows.length === 0) return 'Bruin Analyst: no ranked players yet.';
      const leaders = result.rows.slice(0, 3)
        .map((row, index) => {
          const name = fmt(cell(row, result.columns, 'player_name'));
          const impact = fmt(cell(row, result.columns, 'impact_score'));
          const goals = fmt(cell(row, result.columns, 'goals'));
          return `${index + 1}) ${name}: ${impact} impact, ${goals} goals`;
        })
        .join(' | ');
      return `Bruin Analyst: ${leaders}`;
    },
  },
  xg: {
    intent: 'xg',
    description: 'Expected goals overperformance.',
    query: `
      SELECT player_name, goals, total_xg, xg_overperformance, profile
      FROM marts.xg_overperformance
      ORDER BY xg_overperformance DESC, goals DESC
      LIMIT 3
    `,
    format: (result) => {
      if (!result || result.rows.length === 0) return 'Bruin Analyst: no xG profiles yet.';
      const row = result.rows[0];
      return `Bruin Analyst: ${fmt(cell(row, result.columns, 'player_name'))} is most clinical: ${fmt(cell(row, result.columns, 'goals'))} goals from ${fmt(cell(row, result.columns, 'total_xg'))} xG (${fmt(cell(row, result.columns, 'xg_overperformance'))}), ${fmt(cell(row, result.columns, 'profile'))}.`;
    },
  },
  lastMatch: {
    intent: 'lastMatch',
    description: 'Latest match summary.',
    query: `
      SELECT started_at, winner, red_score, blue_score, red_players, blue_players, red_xg, blue_xg
      FROM marts.team_match_summary
      ORDER BY started_at DESC
      LIMIT 1
    `,
    format: (result) => {
      const row = result?.rows[0];
      if (!row || !result) return 'Bruin Analyst: no match history yet.';
      return `Bruin Analyst: last match ${fmt(cell(row, result.columns, 'red_score'))}-${fmt(cell(row, result.columns, 'blue_score'))}, winner ${fmt(cell(row, result.columns, 'winner'))}. xG red ${fmt(cell(row, result.columns, 'red_xg'))}, blue ${fmt(cell(row, result.columns, 'blue_xg'))}.`;
    },
  },
  upsets: {
    intent: 'upsets',
    description: 'Matches where score winner differed from xG winner.',
    query: `
      WITH upsets AS (
        SELECT game_id, started_at, winner, xg_winner, red_score, blue_score, red_xg, blue_xg
        FROM marts.team_match_summary
        WHERE winner <> 'draw'
          AND xg_winner <> 'even'
          AND winner <> xg_winner
      )
      SELECT
        count(*) AS upset_count,
        max(started_at) AS latest_upset_at,
        any_value(winner ORDER BY started_at DESC) AS latest_winner,
        any_value(xg_winner ORDER BY started_at DESC) AS latest_xg_winner
      FROM upsets
    `,
    format: (result) => {
      const row = result?.rows[0];
      if (!row || !result) return 'Bruin Analyst: no upset data yet.';
      const count = Number(cell(row, result.columns, 'upset_count') ?? 0);
      if (count === 0) return 'Bruin Analyst: no scoreboard-vs-xG upsets found yet.';
      return `Bruin Analyst: ${count} xG upset(s). Latest: ${fmt(cell(row, result.columns, 'latest_winner'))} won although ${fmt(cell(row, result.columns, 'latest_xg_winner'))} led xG.`;
    },
  },
  lineups: {
    intent: 'lineups',
    description: 'Best repeated lineups.',
    query: `
      WITH sides AS (
        SELECT red_players AS lineup, 'red' AS side, winner, red_score AS goals, blue_score AS goals_against, red_xg AS xg
        FROM marts.team_match_summary
        WHERE red_players IS NOT NULL AND red_players <> ''
        UNION ALL
        SELECT blue_players AS lineup, 'blue' AS side, winner, blue_score AS goals, red_score AS goals_against, blue_xg AS xg
        FROM marts.team_match_summary
        WHERE blue_players IS NOT NULL AND blue_players <> ''
      )
      SELECT
        lineup,
        count(*) AS games,
        sum(CASE WHEN winner = side THEN 1 ELSE 0 END) AS wins,
        round(100.0 * sum(CASE WHEN winner = side THEN 1 ELSE 0 END) / nullif(count(*), 0), 1) AS win_rate,
        round(sum(xg), 2) AS xg
      FROM sides
      GROUP BY lineup
      ORDER BY games DESC, win_rate DESC, xg DESC
      LIMIT 3
    `,
    format: (result) => {
      if (!result || result.rows.length === 0) return 'Bruin Analyst: no lineup data yet.';
      const best = result.rows[0];
      return `Bruin Analyst: most seen lineup is ${fmt(cell(best, result.columns, 'lineup'))}: ${fmt(cell(best, result.columns, 'games'))} games, ${fmt(cell(best, result.columns, 'win_rate'))}% win rate.`;
    },
  },
  heatmap: {
    intent: 'heatmap',
    description: 'Team territory from heatmap cells.',
    query: `
      SELECT
        CASE team WHEN 1 THEN 'red' WHEN 2 THEN 'blue' ELSE CAST(team AS VARCHAR) END AS team_name,
        sum(touches) AS touches,
        round(avg(cell_x), 1) AS avg_x_cell,
        round(avg(cell_y), 1) AS avg_y_cell
      FROM marts.heatmap_cells
      GROUP BY team
      ORDER BY touches DESC
      LIMIT 2
    `,
    format: (result) => {
      if (!result || result.rows.length === 0) return 'Bruin Analyst: no heatmap data yet.';
      const parts = result.rows.map((row) => `${fmt(cell(row, result.columns, 'team_name'))}: ${fmt(cell(row, result.columns, 'touches'))} touches`);
      return `Bruin Analyst: territory sample - ${parts.join(' | ')}.`;
    },
  },
  pipeline: {
    intent: 'pipeline',
    description: 'Bruin pipeline freshness.',
    query: `
      SELECT metric, value
      FROM marts.pipeline_freshness
      WHERE metric IN ('games', 'snapshot_rows', 'event_rows', 'ranked_players', 'last_snapshot_at')
      ORDER BY metric
    `,
    format: (result) => {
      if (!result || result.rows.length === 0) return 'Bruin Analyst: pipeline freshness is unavailable.';
      const metrics = new Map(result.rows.map((row) => [String(cell(row, result.columns, 'metric')), fmt(cell(row, result.columns, 'value'))]));
      return `Bruin Analyst: pipeline has ${metrics.get('games') ?? '0'} games, ${metrics.get('snapshot_rows') ?? '0'} snapshots, ${metrics.get('event_rows') ?? '0'} events. Last snapshot: ${metrics.get('last_snapshot_at') ?? 'n/a'}.`;
    },
  },
};

export async function answerBruinChatQuestion(rawMessage: string): Promise<BruinChatAnswer> {
  const question = cleanQuestion(rawMessage);
  const intent = classifyQuestion(question);
  const definition = INTENTS[intent];

  if (!definition.query) {
    return {
      intent,
      question,
      sql: null,
      answer: definition.format(),
    };
  }

  const sql = definition.query.trim();
  const result = await runQueuedBruinQuery(sql);

  return {
    intent,
    question,
    sql,
    answer: definition.format(result),
  };
}
