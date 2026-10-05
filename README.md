# The Media League

Rank the films, TV shows and games you love by picking winners in head-to-head matchups. Answer enough of them and the app works out your league table, then exports your film rankings to Letterboxd.

## Run it

Double-click **`Start Media League.cmd`**, or:

```bash
npm install
npm run dev        # http://localhost:5173
```

Your results are saved in the browser's local storage. Use **Export → Backup** to move them to another machine.

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm test` | Run the unit tests (ranking engine, matchmaker, penalties, exports) |
| `npm run build` | Type-check and build a static copy into `dist/` (serve it with `npm run preview`) |
| `npm run data` | Re-download the film, TV and game lists (about 5 minutes) |

## How it plays

- **Pick a winner.** Click either side of the matchup, or press <kbd>←</kbd> / <kbd>→</kbd>.
- **Not seen it?** Press **Not seen** under that title. It leaves the league and a new opponent steps in. You can also mark seen and unseen titles in bulk on a league's titles tab, which speeds things up a lot.
- **Still can't decide?** Press <kbd>↓</kbd> to take it to penalties. You get up to five questions about the specific medium, such as story, cinematography or score for films, consistency across seasons or the ending for TV, and gameplay, art direction or replay value for games. Then the app tells you who it thinks won: *"Ah, so you think Titanic is better."* Accept it, overrule it, or call it a draw. If it's level after five questions, it goes to sudden death.
- **Other keys:** <kbd>S</kbd> skips a matchup; <kbd>U</kbd> or the ‹ arrow undoes the last result.
- **Matchdays:** results are grouped into matchdays of 10. The table's arrows show who moved since the current matchday started.

## How the table is worked out

- **Ratings** use a [Bradley–Terry model](https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model), refitted to every result after each pick. It's the statistics behind "A beats B with probability *p*". Unlike Elo, the order you answered in doesn't matter. The model also gives each title an uncertainty, which drives the **settled %** and the **Provisional** tags.
- **Result weights:** a straight pick counts as a win. A win on penalties counts as a narrow win (0.75–0.25), because a hard choice means the two are close. A draw counts as half each.
- **Matchmaking** always picks the most informative next matchup: a close contest between titles whose placings are still uncertain. It brings in untried titles gradually, starting with the best known ones (by IMDb vote count), so you aren't shown obscure films straight away.
- **Settled %:** a title counts as settled after roughly 14 close matchups. The table also estimates how many more matchups it would take to settle everything.

## Where the data comes from

All sources are free and need no API key. The lists are downloaded ahead of time into `src/data/*.json`, so the app loads instantly and works without depending on those services being up.

| League | List | Metadata and art |
|---|---|---|
| Movies | IMDb Top 250, via IMDb's public GraphQL endpoint | [Cinemeta](https://v3-cinemeta.strem.io) (Stremio's open metadata API): backdrops, title logos, director and cast. Posters from IMDb. |
| TV Shows | IMDb Top 250 TV | Same as Movies. |
| Games | Wikipedia's [list of video games listed among the best](https://en.wikipedia.org/wiki/List_of_video_games_listed_among_the_best), an aggregate of 106 critics' lists | Wikipedia box art and summaries, Wikidata IDs, Steam library art (hero image, portrait capsule, logo), and the Microsoft Store for a few games not on Steam. |

**Why games come from Wikipedia.** There's no IMDb-style chart for games, and the main game databases (IGDB, RAWG, MobyGames, Giant Bomb) all need a key. The Wikipedia list is the closest thing to a critical consensus. Ranking by raw citation count favours old games, which have had decades of lists to appear on. So each game is scored by the share of lists published since its release that include it. That puts Baldur's Gate 3 at #43 rather than leaving it out. 113 of the 250 games have wide hero art from Steam or the Microsoft Store. The rest, including every Nintendo and PlayStation exclusive, show their box art over a blurred background.

**Adding titles.** Each league has an **Add** button that searches live, using Cinemeta for films and TV and Wikipedia for games. Use it for anything missing from the starting lists.

IMDb data is used for personal, non-commercial purposes in line with [IMDb's terms](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX).

## Exporting to Letterboxd

From **Movies → Export**:

1. **Ranked list:** download the CSV. On Letterboxd, start a [new list](https://letterboxd.com/list/new/), tick *Ranked list*, choose *Import* and pick the file. Letterboxd keeps the file's order, so the ranking carries over.
2. **Star ratings (optional):** this turns table positions into ratings from 5★ down to a minimum you choose, for [letterboxd.com/import](https://letterboxd.com/import/). Importing replaces any ratings you've already given those films.

Letterboxd only covers films, so TV and games export as a plain CSV spreadsheet.

## Project layout

```
src/
  lib/          rating.ts (Bradley–Terry), matchmaker.ts, penalties.ts, export.ts,
                store.ts (zustand + localStorage), lookup.ts (live search), catalog.ts
  components/   Arena (matchup hero), PenaltyShootout, LeagueTable, TitleGrid,
                TitleModal, ExportPanel, AddTitle, TopNav, Poster…
  pages/        HomePage, LeaguePage
  data/         movies.json, tv.json, games.json (generated)
scripts/        build-media.mjs (films + TV), build-games.mjs (games)
```

Built with Vite, React 19, TypeScript, zustand and lucide icons. The typefaces are Big Shoulders Display (stadium-signage condensed) and Barlow.
