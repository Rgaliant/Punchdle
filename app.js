(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const EPOCH = Date.UTC(2026, 10, 4); // Punchdle #1 = 2026-11-04
  const STORAGE_KEY = 'punchdle:v1';
  const MIN_TARGET_MS = 1500;
  const MAX_TARGET_MS = 6500;
  const HINT_WINDOW_MS = 2500;
  const PERFECT_WINDOW_S = 0.02;
  const SCORE_FALLOFF_S = 0.75; // larger = more forgiving

  const TIERS = [
    { min: 999, name: 'PERFECT PUNCH', emoji: '🟨' },
    { min: 900, name: 'HAYMAKER', emoji: '🟩' },
    { min: 750, name: 'KNOCKOUT', emoji: '🟩' },
    { min: 500, name: 'SOLID HIT', emoji: '🟦' },
    { min: 250, name: 'JAB', emoji: '🟪' },
    { min: 1, name: 'LOVE TAP', emoji: '🟥' },
    { min: 0, name: 'WHIFF', emoji: '⬛' },
  ];

  const BAG_NAMES = [
    'a featherweight bag', 'a well-worn leather bag', 'a heavy bag',
    'a freshly taped bag', 'a suspiciously lumpy bag', 'the old gym bag',
    'a brand-new bag', 'a sandbag', 'a squeaky bag', 'a championship bag',
  ];

  // ---------------------------------------------------------------------------
  // Date + seeded RNG
  // ---------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyToUTC = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const dayNumber = (key) => Math.round((keyToUTC(key) - EPOCH) / 864e5) + 1;
  const shiftKey = (key, days) => {
    const d = new Date(keyToUTC(key) + days * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  // cyrb53 string hash -> 32-bit seed
  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyPuzzle(key) {
    const rng = mulberry32(hashString(`punchdle|${key}`));
    const target = Math.round((MIN_TARGET_MS + rng() * (MAX_TARGET_MS - MIN_TARGET_MS)) / 10) * 10;
    // Hint window: 2.5s wide, snapped to half seconds, always contains the target.
    const offset = rng() * (HINT_WINDOW_MS - 500);
    const lo = Math.max(500, Math.floor((target - offset) / 500) * 500);
    const hi = lo + HINT_WINDOW_MS;
    const bag = BAG_NAMES[Math.floor(rng() * BAG_NAMES.length)];
    return { key, number: dayNumber(key), target, lo, hi, bag };
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  function scoreFor(heldMs, targetMs) {
    const err = Math.abs(heldMs - targetMs) / 1000;
    if (err <= PERFECT_WINDOW_S) return 999;
    return Math.min(998, Math.round(999 * Math.exp(-err / SCORE_FALLOFF_S)));
  }
  const tierFor = (score) => TIERS.find((t) => score >= t.min);

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  const defaultState = () => ({ history: {}, achievements: {}, pending: null, seenHelp: false, sound: true });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------------------
  // Stats helpers
  // ---------------------------------------------------------------------------
  function streakEndingAt(key) {
    let n = 0;
    while (state.history[key]) { n++; key = shiftKey(key, -1); }
    return n;
  }
  function computeStats() {
    const keys = Object.keys(state.history).sort();
    const entries = keys.map((k) => state.history[k]);
    let maxStreak = 0, run = 0, prev = null;
    for (const k of keys) {
      run = prev && shiftKey(prev, 1) === k ? run + 1 : 1;
      maxStreak = Math.max(maxStreak, run);
      prev = k;
    }
    const total = entries.reduce((s, e) => s + e.score, 0);
    const today = dateKey();
    const current = state.history[today] ? streakEndingAt(today) : streakEndingAt(shiftKey(today, -1));
    return {
      played: entries.length,
      total,
      best: entries.reduce((m, e) => Math.max(m, e.score), 0),
      average: entries.length ? Math.round(total / entries.length) : 0,
      streak: current,
      maxStreak,
    };
  }

  // ---------------------------------------------------------------------------
  // Achievements
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'first', icon: '🥊', name: 'First Punch', desc: 'Throw your first punch.', check: (c) => c.stats.played >= 1 },
    { id: 'jab', icon: '👊', name: 'Connected', desc: 'Score 250 or more.', check: (c) => c.r.score >= 250 },
    { id: 'solid', icon: '💪', name: 'Solid Contact', desc: 'Score 500 or more.', check: (c) => c.r.score >= 500 },
    { id: 'knockout', icon: '🔔', name: 'Knockout', desc: 'Score 750 or more.', check: (c) => c.r.score >= 750 },
    { id: 'haymaker', icon: '💥', name: 'Haymaker', desc: 'Score 900 or more.', check: (c) => c.r.score >= 900 },
    { id: 'perfect', icon: '💎', name: 'Perfect Punch', desc: 'Release within 0.02s of the sweet spot.', check: (c) => c.r.score === 999 },
    { id: 'close', icon: '🤏', name: 'So Close', desc: 'Miss the sweet spot by less than 0.1s (but not perfect).', check: (c) => c.r.score < 999 && c.err < 0.1 },
    { id: 'whiff', icon: '💨', name: 'Total Whiff', desc: 'Score exactly 0. It happens to the best of us.', secret: true, check: (c) => !c.r.forfeit && c.r.score === 0 },
    { id: 'lucky', icon: '🍀', name: 'Lucky Sevens', desc: 'Score exactly 777.', secret: true, check: (c) => c.r.score === 777 },
    { id: 'hair', icon: '⚡', name: 'Hair Trigger', desc: 'Let go in under half a second.', secret: true, check: (c) => !c.r.forfeit && c.r.held < 500 },
    { id: 'monk', icon: '🧘', name: 'Patience of a Monk', desc: 'Hold for more than 10 seconds.', secret: true, check: (c) => !c.r.forfeit && c.r.held > 10000 },
    { id: 'early', icon: '🌅', name: 'Early Bird', desc: 'Punch between 4 AM and 7 AM.', check: (c) => c.hour >= 4 && c.hour < 7 },
    { id: 'owl', icon: '🦉', name: 'Night Owl', desc: 'Punch between midnight and 4 AM.', secret: true, check: (c) => c.hour < 4 },
    { id: 'weekend', icon: '🏖️', name: 'Weekend Warrior', desc: 'Punch on a Saturday and the Sunday after.', check: (c) => c.weekday === 0 && !!state.history[shiftKey(c.key, -1)] },
    { id: 'comeback', icon: '📈', name: 'Comeback Kid', desc: "Beat yesterday's score by 400 or more.", check: (c) => { const y = state.history[shiftKey(c.key, -1)]; return !!y && c.r.score - y.score >= 400; } },
    { id: 'consistent', icon: '🎯', name: 'Consistent', desc: 'Score 600+ three days in a row.', check: (c) => [0, -1, -2].every((d) => (state.history[shiftKey(c.key, d)] || { score: -1 }).score >= 600) },
    { id: 'streak3', icon: '🔥', name: 'On a Roll', desc: 'Play 3 days in a row.', check: (c) => c.stats.streak >= 3 },
    { id: 'streak7', icon: '📅', name: 'Week of Fury', desc: 'Play 7 days in a row.', check: (c) => c.stats.streak >= 7 },
    { id: 'streak30', icon: '🗓️', name: 'Iron Will', desc: 'Play 30 days in a row.', check: (c) => c.stats.streak >= 30 },
    { id: 'played10', icon: '🥉', name: 'Regular', desc: 'Play 10 days.', check: (c) => c.stats.played >= 10 },
    { id: 'played50', icon: '🥈', name: 'Contender', desc: 'Play 50 days.', check: (c) => c.stats.played >= 50 },
    { id: 'played100', icon: '🥇', name: 'Champion', desc: 'Play 100 days.', check: (c) => c.stats.played >= 100 },
    { id: 'total5k', icon: '🏋️', name: 'Heavy Hands', desc: 'Earn 5,000 total punch points.', check: (c) => c.stats.total >= 5000 },
    { id: 'total25k', icon: '🦾', name: 'Iron Fists', desc: 'Earn 25,000 total punch points.', check: (c) => c.stats.total >= 25000 },
  ];

  function evaluateAchievements(key, result) {
    const when = new Date(result.at);
    const ctx = {
      key,
      r: result,
      err: result.forfeit ? Infinity : Math.abs(result.held - result.target) / 1000,
      hour: when.getHours(),
      weekday: when.getDay(),
      stats: computeStats(),
    };
    const unlocked = [];
    for (const a of ACHIEVEMENTS) {
      if (state.achievements[a.id]) continue;
      let ok = false;
      try { ok = a.check(ctx); } catch { ok = false; }
      if (ok) {
        state.achievements[a.id] = key;
        unlocked.push(a);
      }
    }
    return unlocked;
  }

  // ---------------------------------------------------------------------------
  // Sound (tiny WebAudio thud, no assets)
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function ensureAudio() {
    if (!state.sound) return null;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
    return audioCtx;
  }
  function playThud(power) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const vol = 0.15 + power * 0.5;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 + power * 40, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);

    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    const ng = ctx.createGain();
    noise.buffer = buf;
    ng.gain.value = vol * 0.6;
    noise.connect(ng).connect(ctx.destination);
    noise.start(t);
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    dayLabel: $('day-label'),
    hint: $('hint'),
    holdBtn: $('hold-btn'),
    holdText: $('hold-btn-text'),
    prePlay: $('pre-play'),
    result: $('result'),
    resHeld: $('res-held'),
    resTarget: $('res-target'),
    resOff: $('res-off'),
    display: $('display-value'),
    tier: $('display-tier'),
    share: $('share-btn'),
    countdown: $('countdown'),
    glove: $('glove'),
    bag: $('bag'),
    pow: $('pow'),
    machine: document.querySelector('.machine'),
    toasts: $('toasts'),
    sound: $('btn-sound'),
  };

  const fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toast(html, { achievement = false, life = 2200 } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (achievement ? ' achievement' : '');
    t.style.setProperty('--toast-life', `${life}ms`);
    t.innerHTML = html;
    el.toasts.appendChild(t);
    setTimeout(() => t.remove(), life + 400);
  }

  function openModal(id) {
    if (id === 'modal-stats') renderStats();
    if (id === 'modal-achievements') renderAchievements();
    $(id).classList.remove('hidden');
  }
  function closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const state = loadState();
  const todayKey = dateKey();
  const puzzle = dailyPuzzle(todayKey);

  // Allow `?reset` for local testing: clears today's punch.
  if (new URLSearchParams(location.search).has('reset')) {
    delete state.history[todayKey];
    state.pending = null;
    for (const [id, k] of Object.entries(state.achievements)) if (k === todayKey) delete state.achievements[id];
    saveState();
    history.replaceState(null, '', location.pathname);
  }

  // A hold that was started but never finished (refresh / tab closed mid-hold) counts as a whiff.
  if (state.pending && !state.history[state.pending]) {
    const k = state.pending;
    const p = dailyPuzzle(k);
    state.history[k] = { held: null, target: p.target, score: 0, at: Date.now(), forfeit: true };
    state.pending = null;
    evaluateAchievements(k, state.history[k]);
    saveState();
  } else if (state.pending) {
    state.pending = null;
    saveState();
  }

  let holding = false;
  let holdStart = 0;
  let rafId = 0;

  function startHold() {
    if (holding || state.history[todayKey]) return;
    holding = true;
    holdStart = performance.now();
    state.pending = todayKey;
    saveState();
    ensureAudio(); // unlock audio on a user gesture
    el.holdBtn.classList.add('holding');
    el.holdText.textContent = 'WINDING UP…';
    el.display.textContent = '???';
    el.display.classList.add('charging');
    el.tier.innerHTML = '&nbsp;';
    chargeLoop();
  }

  function chargeLoop() {
    const t = (performance.now() - holdStart) / 1000;
    // Pull the glove back and shake it harder the longer you hold. Deliberately
    // non-linear so it can't be used as a precise timer.
    const pull = Math.min(42, 42 * (1 - Math.exp(-t / 1.6)));
    const shake = reduceMotion ? 0 : Math.min(4, 0.6 + t * 0.55);
    const jx = (Math.random() - 0.5) * shake;
    const jy = (Math.random() - 0.5) * shake;
    el.glove.style.transform = `translate(${-pull + jx}px, ${jy}px) rotate(${-pull / 6}deg)`;
    rafId = requestAnimationFrame(chargeLoop);
  }

  function releaseHold() {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(rafId);
    const held = Math.round(performance.now() - holdStart);
    const score = scoreFor(held, puzzle.target);
    const result = { held, target: puzzle.target, score, at: Date.now() };

    state.history[todayKey] = result;
    state.pending = null;
    const unlocked = evaluateAchievements(todayKey, result);
    saveState();

    el.holdBtn.classList.remove('holding');
    el.display.classList.remove('charging');
    animatePunch(score).then(() => {
      showResult(result, true);
      unlocked.forEach((a, i) => setTimeout(() => {
        toast(`<span class="t-icon">${a.icon}</span><span>Achievement unlocked!<small>${a.name}</small></span>`, { achievement: true, life: 3200 });
      }, 400 + i * 900));
    });
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  function animatePunch(score) {
    const power = score / 999;
    const from = el.glove.style.transform || 'translate(0px, 0px)';
    el.glove.style.transform = '';

    if (reduceMotion) {
      playThud(power);
      return countUp(score, 0);
    }

    const reach = score === 0 ? 30 : 58; // a whiff stops short of the bag
    el.glove.animate(
      [
        { transform: from },
        { transform: `translate(${reach}px, 0px) rotate(4deg)`, offset: 0.3 },
        { transform: `translate(${reach - 6}px, 0px)`, offset: 0.45 },
        { transform: 'translate(0px, 0px)' },
      ],
      { duration: 650, easing: 'cubic-bezier(.2,.9,.3,1)' }
    );

    return new Promise((resolve) => {
      setTimeout(() => {
        if (score > 0) {
          playThud(power);
          const amp = 3 + power * 34;
          el.bag.animate(
            [
              { transform: 'rotate(0deg)' },
              { transform: `rotate(${-amp}deg)`, offset: 0.18 },
              { transform: `rotate(${amp * 0.6}deg)`, offset: 0.42 },
              { transform: `rotate(${-amp * 0.32}deg)`, offset: 0.64 },
              { transform: `rotate(${amp * 0.14}deg)`, offset: 0.82 },
              { transform: 'rotate(0deg)' },
            ],
            { duration: 1200 + power * 900, easing: 'ease-out' }
          );
          const s = 0.6 + power * 0.9;
          el.pow.animate(
            [
              { opacity: 0, transform: 'scale(.3)' },
              { opacity: 1, transform: `scale(${s})`, offset: 0.25 },
              { opacity: 1, transform: `scale(${s * 1.05})`, offset: 0.7 },
              { opacity: 0, transform: `scale(${s * 1.2})` },
            ],
            { duration: 700, easing: 'ease-out' }
          );
          if (score >= 750) {
            el.machine.classList.remove('shake');
            void el.machine.offsetWidth;
            el.machine.classList.add('shake');
          }
        }
        countUp(score, 900).then(resolve);
      }, 190);
    });
  }

  function countUp(score, duration) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        const p = duration ? Math.min(1, (now - start) / duration) : 1;
        const eased = 1 - Math.pow(1 - p, 3);
        el.display.textContent = String(Math.round(score * eased)).padStart(3, '0');
        if (p < 1) requestAnimationFrame(tick);
        else {
          setDisplay(score);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function setDisplay(score) {
    el.display.textContent = String(score).padStart(3, '0');
    el.display.classList.toggle('perfect', score === 999);
    el.tier.textContent = tierFor(score).name;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderIntro() {
    el.dayLabel.textContent = `Punchdle #${puzzle.number} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
    el.hint.innerHTML = `Today you're facing <strong>${puzzle.bag}</strong>.<br>The sweet spot is somewhere between <strong>${(puzzle.lo / 1000).toFixed(1)}s</strong> and <strong>${(puzzle.hi / 1000).toFixed(1)}s</strong>.`;
    el.sound.textContent = state.sound ? '🔊' : '🔇';
    document.getElementById('tier-list').innerHTML = TIERS.map((t) => `<li><span>${t.emoji} ${t.name}</span><span>${t.min === 999 ? '999' : t.min === 0 ? '0' : t.min + '+'}</span></li>`).join('');
  }

  function showResult(result, fresh) {
    el.prePlay.classList.add('hidden');
    el.result.classList.remove('hidden');
    setDisplay(result.score);
    el.resHeld.textContent = result.forfeit ? '—' : fmt(result.held);
    el.resTarget.textContent = fmt(result.target);
    el.resOff.textContent = result.forfeit ? 'forfeit' : fmt(Math.abs(result.held - result.target));
    if (fresh && result.score === 999) toast('💎 PERFECT PUNCH! 💎', { life: 3000 });
    startCountdown();
  }

  function startCountdown() {
    const update = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ms = next - now;
      if (ms <= 0 || dateKey(now) !== todayKey) { location.reload(); return; }
      const s = Math.floor(ms / 1000);
      el.countdown.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    };
    update();
    setInterval(update, 1000);
  }

  function renderStats() {
    const s = computeStats();
    $('stats-row').innerHTML = [
      [s.played, 'Played'], [s.streak, 'Streak'], [s.maxStreak, 'Max streak'], [s.best, 'Best'], [s.average, 'Average'],
    ].map(([v, l]) => `<div><span class="stat-num">${v}</span><span class="stat-label">${l}</span></div>`).join('');

    const entries = Object.values(state.history);
    const counts = TIERS.map((t) => entries.filter((e) => tierFor(e.score) === t).length);
    const max = Math.max(1, ...counts);
    const todayTier = state.history[todayKey] ? tierFor(state.history[todayKey].score) : null;
    $('dist').innerHTML = TIERS.map((t, i) => `
      <div class="dist-row"><span>${t.name.replace('PERFECT PUNCH', 'PERFECT')}</span>
        <div class="dist-bar ${t === todayTier ? 'today' : ''}" data-w="${Math.max(7, (counts[i] / max) * 100)}">${counts[i]}</div>
      </div>`).join('');
    requestAnimationFrame(() => document.querySelectorAll('.dist-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; }));

    let html = '';
    for (let d = -6; d <= 0; d++) {
      const k = shiftKey(todayKey, d);
      const e = state.history[k];
      const label = new Date(keyToUTC(k)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
      html += `<div class="recent-day ${e ? '' : 'empty'}">${label}<b>${e ? e.score : '—'}</b></div>`;
    }
    $('recent').innerHTML = html;
  }

  function renderAchievements() {
    const got = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
    $('ach-count').textContent = `${got} / ${ACHIEVEMENTS.length}`;
    $('ach-grid').innerHTML = ACHIEVEMENTS.map((a) => {
      const k = state.achievements[a.id];
      const hidden = a.secret && !k;
      const date = k ? new Date(keyToUTC(k)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
      return `<div class="ach ${k ? 'unlocked' : 'locked'}">
        <span class="ach-icon">${hidden ? '❓' : a.icon}</span>
        <span class="ach-name">${hidden ? 'Secret' : a.name}</span>
        <span class="ach-desc">${hidden ? 'Keep punching to find out.' : a.desc}</span>
        ${k ? `<span class="ach-date">Unlocked ${date}</span>` : ''}
      </div>`;
    }).join('');
  }

  function shareText() {
    const r = state.history[todayKey];
    if (!r) return '';
    const tier = tierFor(r.score);
    const filled = Math.round(r.score / 100);
    const bar = tier.emoji.repeat(filled) + '⬜'.repeat(10 - filled);
    const off = r.forfeit ? 'forfeit' : `${(Math.abs(r.held - r.target) / 1000).toFixed(2)}s off`;
    const s = computeStats();
    return `Punchdle #${puzzle.number} 🥊\n${r.score}/999 · ${tier.name}\n${bar}\n⏱️ ${off} · 🔥 ${s.streak}\n${location.origin}${location.pathname}`;
  }

  async function share() {
    const text = shareText();
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); return; } catch { /* fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('📋 Copied results to clipboard');
    } catch {
      window.prompt('Copy your result:', text);
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  el.holdBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { el.holdBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    startHold();
  });
  el.holdBtn.addEventListener('pointerup', releaseHold);
  el.holdBtn.addEventListener('pointercancel', releaseHold);
  el.holdBtn.addEventListener('lostpointercapture', releaseHold);
  el.holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeModals();
    if (e.code !== 'Space' || document.querySelector('.modal:not(.hidden)')) return;
    e.preventDefault();
    if (!e.repeat) startHold();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    releaseHold();
  });
  // Switching away mid-hold throws the punch immediately.
  window.addEventListener('blur', releaseHold);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHold(); });

  el.share.addEventListener('click', share);
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  $('btn-stats').addEventListener('click', () => openModal('modal-stats'));
  $('btn-achievements').addEventListener('click', () => openModal('modal-achievements'));
  el.sound.addEventListener('click', () => {
    state.sound = !state.sound;
    el.sound.textContent = state.sound ? '🔊' : '🔇';
    saveState();
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) closeModals(); });
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  renderIntro();
  const existing = state.history[todayKey];
  if (existing) {
    showResult(existing, false);
  } else if (!state.seenHelp) {
    state.seenHelp = true;
    saveState();
    openModal('modal-help');
  }
})();
