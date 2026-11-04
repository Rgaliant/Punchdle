# Punchdle 🥊

A daily punching-bag game in the style of Wordle. You get **one punch per day**.

Press and hold the button (or spacebar) to wind up, then let go to punch. Each day has a secret
**sweet spot** hold time between 1.5s and 6.5s, the same for every player. The closer you let go to it,
the more **punch points** you score, up to 999.

## How it works

- **Daily target:** The date (`YYYY-MM-DD`, local time) is hashed into a seeded RNG. That picks the sweet spot,
  a 2.5s hint window that contains it, and some flavor text. No server is needed, and everyone gets the same puzzle.
- **Scoring:** `999 · e^(-error / 0.75s)`. Releasing within 0.02s gives a **PERFECT PUNCH** (999).
  Ratings: Perfect (999) · Haymaker (900+) · Knockout (750+) · Solid Hit (500+) · Jab (250+) · Love Tap (1+) · Whiff (0).
- **No timer:** While you hold, the display shows `???`. The glove pulls back and shakes harder over time, but not
  in a way you can read as a clock.
- **Once per day:** Results are saved in `localStorage`. If you switch tabs mid-hold, the punch is thrown right away.
  If the page is killed mid-hold, the day counts as a forfeit (0).
- **Achievements:** 24 achievements, some of them secret: score milestones, Perfect Punch, streaks (3/7/30),
  games played, total points, Early Bird / Night Owl, Weekend Warrior, Comeback Kid, Lucky Sevens, and more.
- **Stats and sharing:** Games played, current and max streak, best and average score, score distribution, the last 7 days,
  and an emoji result you can share.

## Running it

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy, enable GitHub Pages on the repo (Settings → Pages → deploy from branch, root folder).

**Testing:** Add `?reset` to the URL to clear today's punch and play again.

## Files

- `index.html`: markup, SVG bag and glove, and the modals
- `style.css`: arcade styling
- `app.js`: daily seeding, scoring, input, animation, achievements, stats, and sharing
