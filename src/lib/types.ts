export type LeagueKind = 'movie' | 'tv' | 'game';

export interface Title {
  id: string;
  kind: LeagueKind;
  title: string;
  year: number | null;
  endYear?: number | null;
  /** Position in the source list (IMDb Top 250, critics' consensus for games). */
  rank: number;
  poster: string;
  /** Wide landscape art for the matchup hero. */
  background: string | null;
  /** Transparent title logo. */
  logo: string | null;
  genres: string[];
  credit: string | null;
  creditLabel: string;
  summary: string;
  score: number | null;
  /** Rough familiarity (IMDb vote count). Familiar titles are introduced into matchups first. */
  popularity?: number | null;
  meta: string | null;
  links: Partial<Record<'imdb' | 'letterboxd' | 'wikipedia' | 'steam', string>>;
  /** True for titles the user added themselves via search. */
  custom?: boolean;
}

export type MatchMethod = 'pick' | 'penalties' | 'draw';

export interface Match {
  a: string;
  b: string;
  /** Result from A's point of view: 1 win, 0.5 draw, 0 loss. Penalty wins are 0.75 / 0.25. */
  s: number;
  at: number;
  method: MatchMethod;
  /** Penalty shootout: score for A and B (each kick is one question). */
  pens?: [number, number];
}

export type SeenStatus = 'seen' | 'unseen';

export interface LeagueState {
  status: Record<string, SeenStatus>;
  matches: Match[];
  custom: Title[];
  /** The pair currently on screen, so a reload shows the same matchup. */
  current: [string, string] | null;
  /** Ranks at the start of the current matchday; drives the movement arrows. */
  snapshot: Record<string, number>;
  /** Recently skipped pairs, so skipping doesn't bring them straight back. */
  skipped: string[];
}

export interface Standing {
  id: string;
  position: number;
  rating: number;
  /** Log-strength and its posterior standard deviation from the Bradley-Terry fit. */
  theta: number;
  sigma: number;
  /** 0..1: how settled this title's placing is. */
  certainty: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  form: ('W' | 'D' | 'L')[];
  movement: number | null;
}
