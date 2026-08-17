/* ─── STATE ─── */
const STORAGE_KEY = 'courtside_state_v11';
let storageAvailable = true;

function defaultState(){
  return {
    config: { numPlayers: 6, durationValue: 2, durationUnit: 'hrs', gamePoint: 21, matchCount: null },
    playerNames: [],
    players: [],
    matches: [],
    matchMinutes: 0,
    generated: false,
    warning: null,
    currentView: 'home',
    balanceStats: null,
    theme: null,
    scores: {},
    timers: {} // matchId -> { running: bool, elapsed: seconds, startTime: timestamp, finalElapsed: seconds, started: bool }
  };
}

function systemPrefersLight(){
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}
function effectiveTheme(){
  return state.theme || (systemPrefersLight() ? 'light' : 'dark');
}
function applyTheme(){
  const theme = effectiveTheme();
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if(btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}
function toggleTheme(){
  state.theme = effectiveTheme() === 'light' ? 'dark' : 'light';
  saveState();
  applyTheme();
}

function loadState(){
  try { const raw = localStorage.getItem(STORAGE_KEY); if(!raw) return defaultState(); return Object.assign(defaultState(), JSON.parse(raw)); }
  catch(e){ storageAvailable = false; return defaultState(); }
}

let state = loadState();

function saveState(){
  if(!storageAvailable) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ storageAvailable = false; }
}

function resetState(){
  const keepTheme = state.theme;
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  state = defaultState();
  state.theme = keepTheme;
  saveState();
  applyTheme();
  renderAll();
  setView('home');
}

/* ─── BALANCED MATCH ENGINE ─── */
const MatchEngine = (function(){
  const TRANSITION_MINUTES = 3;
  const ABS_MIN_MATCH_MINUTES = 4;

  function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

  function matchMinutesForGamePoint(gamePoint){ return Math.max(ABS_MIN_MATCH_MINUTES, Math.round(15 * (gamePoint / 21))); }

  function generateBalancedDoubles(players, desiredCount){
    const n = players.length;
    if(n < 4 || desiredCount <= 0) return { matches: [], stats: null };

    const playerStats = {};
    players.forEach(p => {
      playerStats[p.id] = {
        name: p.name,
        matches: 0,
        restRounds: 0,
        partnerships: {},
        opponents: {}
      };
    });

    const usedCombos = new Set();

    function getTeamKey(team) {
      return team.map(p => p.id).sort().join('+');
    }

    function getMatchKey(teamA, teamB) {
      const keyA = getTeamKey(teamA);
      const keyB = getTeamKey(teamB);
      return [keyA, keyB].sort().join('__');
    }

    function getPartnershipCount(p1, p2) {
      const key = [p1.id, p2.id].sort().join('+');
      return playerStats[p1.id].partnerships[key] || 0;
    }

    function getOpponentCount(p1, p2) {
      const key = [p1.id, p2.id].sort().join('+');
      return playerStats[p1.id].opponents[key] || 0;
    }

    function scoreTeam(team, matchPlayers) {
      let score = 0;
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          score += getPartnershipCount(team[i], team[j]) * 2;
        }
      }
      for (const p of team) {
        score += playerStats[p.id].matches * 3;
      }
      return score;
    }

    function scoreOpponents(teamA, teamB) {
      let score = 0;
      for (const p1 of teamA) {
        for (const p2 of teamB) {
          score += getOpponentCount(p1, p2);
        }
      }
      return score;
    }

    const matches = [];
    const allPlayers = players.slice();

    let attempts = 0;
    const maxAttempts = desiredCount * 200 + 1000;

    while (matches.length < desiredCount && attempts < maxAttempts) {
      attempts++;

      const sortedPlayers = allPlayers.slice().sort((a, b) => {
        const diff = playerStats[a.id].matches - playerStats[b.id].matches;
        if (diff !== 0) return diff;
        return (playerStats[a.id].restRounds || 0) - (playerStats[b.id].restRounds || 0);
      });

      let bestPlayers = null;
      let bestScore = Infinity;

      for (let i = 0; i < Math.min(sortedPlayers.length, 12); i++) {
        for (let j = i + 1; j < Math.min(sortedPlayers.length, 12); j++) {
          for (let k = j + 1; k < Math.min(sortedPlayers.length, 12); k++) {
            for (let l = k + 1; l < Math.min(sortedPlayers.length, 12); l++) {
              const candidates = [sortedPlayers[i], sortedPlayers[j], sortedPlayers[k], sortedPlayers[l]];
              const restScore = candidates.reduce((sum, p) => sum + (playerStats[p.id].restRounds || 0), 0);
              const matchCount = candidates.reduce((sum, p) => sum + playerStats[p.id].matches, 0);
              const totalScore = matchCount * 5 - restScore * 2;

              if (totalScore < bestScore) {
                bestScore = totalScore;
                bestPlayers = candidates;
              }
            }
          }
        }
      }

      if (!bestPlayers) {
        bestPlayers = sortedPlayers.slice(0, 4);
      }

      const [a, b, c, d] = bestPlayers;
      const combos = [
        { teamA: [a, b], teamB: [c, d] },
        { teamA: [a, c], teamB: [b, d] },
        { teamA: [a, d], teamB: [b, c] }
      ];

      const scoredCombos = combos.map(combo => {
        const teamScore = scoreTeam(combo.teamA, bestPlayers) + scoreTeam(combo.teamB, bestPlayers);
        const oppScore = scoreOpponents(combo.teamA, combo.teamB);
        return { ...combo, totalScore: teamScore + oppScore * 2 };
      });

      scoredCombos.sort((a, b) => a.totalScore - b.totalScore);

      const topCombos = scoredCombos.slice(0, Math.min(2, scoredCombos.length));
      const selected = topCombos[Math.floor(Math.random() * topCombos.length)];

      const teamA = selected.teamA;
      const teamB = selected.teamB;
      const matchKey = getMatchKey(teamA, teamB);

      if (usedCombos.has(matchKey) && matches.length < desiredCount * 0.9) {
        const nextCombo = scoredCombos.find(c => !usedCombos.has(getMatchKey(c.teamA, c.teamB)));
        if (nextCombo) {
          const nextTeamA = nextCombo.teamA;
          const nextTeamB = nextCombo.teamB;
          const nextKey = getMatchKey(nextTeamA, nextTeamB);
          if (!usedCombos.has(nextKey) || matches.length >= desiredCount * 0.95) {
            addMatch(nextTeamA, nextTeamB, nextKey);
            continue;
          }
        }
        if (matches.length < desiredCount) {
          addMatch(teamA, teamB, matchKey);
        }
      } else {
        if (matches.length < desiredCount) {
          addMatch(teamA, teamB, matchKey);
        }
      }
    }

    function addMatch(teamA, teamB, key) {
      const matchPlayers = [...teamA, ...teamB];
      
      teamA.forEach(p => playerStats[p.id].matches++);
      teamB.forEach(p => playerStats[p.id].matches++);

      for (let i = 0; i < teamA.length; i++) {
        for (let j = i + 1; j < teamA.length; j++) {
          const key = [teamA[i].id, teamA[j].id].sort().join('+');
          playerStats[teamA[i].id].partnerships[key] = (playerStats[teamA[i].id].partnerships[key] || 0) + 1;
          playerStats[teamA[j].id].partnerships[key] = (playerStats[teamA[j].id].partnerships[key] || 0) + 1;
        }
      }
      for (let i = 0; i < teamB.length; i++) {
        for (let j = i + 1; j < teamB.length; j++) {
          const key = [teamB[i].id, teamB[j].id].sort().join('+');
          playerStats[teamB[i].id].partnerships[key] = (playerStats[teamB[i].id].partnerships[key] || 0) + 1;
          playerStats[teamB[j].id].partnerships[key] = (playerStats[teamB[j].id].partnerships[key] || 0) + 1;
        }
      }

      for (const p1 of teamA) {
        for (const p2 of teamB) {
          const key = [p1.id, p2.id].sort().join('+');
          playerStats[p1.id].opponents[key] = (playerStats[p1.id].opponents[key] || 0) + 1;
          playerStats[p2.id].opponents[key] = (playerStats[p2.id].opponents[key] || 0) + 1;
        }
      }

      allPlayers.forEach(p => {
        if (!matchPlayers.some(mp => mp.id === p.id)) {
          playerStats[p.id].restRounds = (playerStats[p.id].restRounds || 0) + 1;
        }
      });

      usedCombos.add(key);

      matches.push({
        sideA: { playerIds: teamA.map(p => p.id), label: teamA.map(p => p.name).join(' & ') },
        sideB: { playerIds: teamB.map(p => p.id), label: teamB.map(p => p.name).join(' & ') },
        winnerSide: null
      });
    }

    const stats = Object.values(playerStats);
    const maxMatches = Math.max(...stats.map(s => s.matches));
    const minMatches = Math.min(...stats.map(s => s.matches));
    const maxRest = Math.max(...stats.map(s => s.restRounds || 0));
    const minRest = Math.min(...stats.map(s => s.restRounds || 0));

    return {
      matches,
      stats: {
        totalMatches: matches.length,
        players: playerStats,
        maxMatches,
        minMatches,
        maxRest,
        minRest,
        perfectBalance: maxMatches - minMatches <= 1 && maxRest - minRest <= 1
      }
    };
  }

  function assignSchedule(matches, totalMinutes, gamePoint) {
    const count = matches.length;
    if(count === 0) return { matches: [], matchMinutes: 0, warning: null };

    const estMatchMinutes = matchMinutesForGamePoint(gamePoint);
    let matchMinutes = Math.floor((totalMinutes - (count - 1) * TRANSITION_MINUTES) / count);
    let warning = null;

    if(matchMinutes < ABS_MIN_MATCH_MINUTES) {
      matchMinutes = ABS_MIN_MATCH_MINUTES;
      warning = `Tight schedule: matches set to ${ABS_MIN_MATCH_MINUTES}-min floor. Consider reducing match count or increasing time.`;
    }

    if(matchMinutes > estMatchMinutes * 1.5) {
      matchMinutes = Math.min(matchMinutes, Math.round(estMatchMinutes * 1.2));
    }

    let cursor = 0, id = 1;
    const scheduled = matches.map(m => {
      const startMin = cursor, endMin = cursor + matchMinutes;
      cursor = endMin + TRANSITION_MINUTES;
      return {
        id: 'm' + (id++),
        sideA: m.sideA,
        sideB: m.sideB,
        winnerSide: null,
        startMin,
        endMin
      };
    });

    return { matches: scheduled, matchMinutes, warning };
  }

  function generateBalanced(config, players) {
    const totalMinutes = config.durationUnit === 'hrs' ? Number(config.durationValue) * 60 : Number(config.durationValue);
    const result = generateBalancedDoubles(players, config.matchCount);
    
    if (result.matches.length === 0) {
      return { matches: [], matchMinutes: 0, warning: 'Not enough players to generate matches.', balanceStats: null };
    }

    const scheduled = assignSchedule(result.matches, totalMinutes, config.gamePoint);
    
    return {
      matches: scheduled.matches,
      matchMinutes: scheduled.matchMinutes,
      warning: scheduled.warning || (result.stats.perfectBalance ? null : 'Schedule is balanced but not perfect. Consider adjusting match count.'),
      balanceStats: result.stats
    };
  }

  return { generateBalanced, matchMinutesForGamePoint, TRANSITION_MINUTES };
})();

/* ─── HELPERS ─── */
function formatMinutes(min){ const h=Math.floor(min/60), m=min%60; return h>0 ? `${h}:${String(m).padStart(2,'0')}` : `0:${String(m).padStart(2,'0')}`; }
function getGamePoint(){ return Number(document.querySelector('#gamePointSegmented button.active').dataset.point); }
function formatTimer(seconds){
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ─── CORRECTED WIN CONDITION ─── */
function checkWinCondition(scoreA, scoreB, gamePoint) {
  // WIN condition: score >= gamePoint AND lead by 2
  if (Math.abs(scoreA - scoreB) >= 2) {
    // If both scores are at or above gamePoint, whoever is higher wins
    if (scoreA >= gamePoint && scoreB >= gamePoint) {
      return scoreA > scoreB ? 'A' : 'B';
    }
    // If scoreA is above gamePoint, A wins
    if (scoreA > gamePoint) {
      return 'A';
    }
    // If scoreB is above gamePoint, B wins
    if (scoreB > gamePoint) {
      return 'B';
    }
  }
  return null;
}

function getScoreStatus(scoreA, scoreB, gamePoint) {
  // Check if match is already decided
  const winner = checkWinCondition(scoreA, scoreB, gamePoint);
  if (winner) {
    return { status: 'won', winner: winner };
  }
  
  // Check for deuce: both scores at gamePoint-1 or higher, and equal
  if (scoreA >= gamePoint - 1 && scoreB >= gamePoint - 1) {
    if (scoreA === scoreB) {
      return { status: 'deuce' };
    }
    if (Math.abs(scoreA - scoreB) === 1) {
      return { status: 'advantage', leader: scoreA > scoreB ? 'A' : 'B' };
    }
  }
  
  // Check for match point: one player at gamePoint-1, the other below gamePoint-1
  if (scoreA === gamePoint - 1 && scoreB < gamePoint - 1) {
    return { status: 'matchPoint', player: 'A' };
  }
  if (scoreB === gamePoint - 1 && scoreA < gamePoint - 1) {
    return { status: 'matchPoint', player: 'B' };
  }
  
  return { status: 'normal' };
}

// Auto-start timer function
function ensureTimerStarted(matchId) {
  if (!state.timers[matchId]) {
    state.timers[matchId] = { running: false, elapsed: 0, startTime: null, finalElapsed: null, started: false };
  }
  const timer = state.timers[matchId];
  const match = state.matches.find(m => m.id === matchId);
  if (!timer.started && !match.winnerSide) {
    timer.started = true;
    timer.running = true;
    timer.startTime = Date.now() - (timer.elapsed || 0) * 1000;
    saveState();
  }
}

function incrementScore(matchId, side) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match || match.winnerSide) return;

  ensureTimerStarted(matchId);

  if (!state.scores[matchId]) {
    state.scores[matchId] = { sideA: 0, sideB: 0 };
  }

  const scores = state.scores[matchId];
  const gamePoint = state.config.gamePoint;

  if (side === 'A') {
    scores.sideA++;
  } else {
    scores.sideB++;
  }

  const winner = checkWinCondition(scores.sideA, scores.sideB, gamePoint);
  if (winner) {
    match.winnerSide = winner;
    if (state.timers[matchId]) {
      const currentElapsed = getTimerElapsed(matchId);
      if (state.timers[matchId].running) {
        state.timers[matchId].running = false;
      }
      state.timers[matchId].finalElapsed = currentElapsed;
      state.timers[matchId].elapsed = currentElapsed;
    }
  }

  saveState();
  renderMatches();
  renderLeaderboard();
}

function decrementScore(matchId, side) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match || match.winnerSide) return;

  if (!state.scores[matchId]) {
    state.scores[matchId] = { sideA: 0, sideB: 0 };
  }

  const scores = state.scores[matchId];
  if (side === 'A' && scores.sideA > 0) {
    scores.sideA--;
  } else if (side === 'B' && scores.sideB > 0) {
    scores.sideB--;
  }

  match.winnerSide = null;
  if (state.timers[matchId]) {
    state.timers[matchId].finalElapsed = null;
  }

  saveState();
  renderMatches();
  renderLeaderboard();
}

function updateScoreDirect(matchId, side, value) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match || match.winnerSide) return;

  const currentScores = state.scores[matchId] || { sideA: 0, sideB: 0 };
  const numValue = parseInt(value);
  if (isNaN(numValue) || numValue < 0) return;
  
  if (numValue > 0 && currentScores.sideA === 0 && currentScores.sideB === 0) {
    ensureTimerStarted(matchId);
  }

  if (!state.scores[matchId]) {
    state.scores[matchId] = { sideA: 0, sideB: 0 };
  }

  const scores = state.scores[matchId];
  if (side === 'A') {
    scores.sideA = numValue;
  } else {
    scores.sideB = numValue;
  }

  const gamePoint = state.config.gamePoint;
  const winner = checkWinCondition(scores.sideA, scores.sideB, gamePoint);
  if (winner) {
    match.winnerSide = winner;
    if (state.timers[matchId]) {
      const currentElapsed = getTimerElapsed(matchId);
      if (state.timers[matchId].running) {
        state.timers[matchId].running = false;
      }
      state.timers[matchId].finalElapsed = currentElapsed;
      state.timers[matchId].elapsed = currentElapsed;
    }
  } else {
    match.winnerSide = null;
    if (state.timers[matchId]) {
      state.timers[matchId].finalElapsed = null;
    }
  }

  saveState();
  renderMatches();
  renderLeaderboard();
}

/* ─── TIMER FUNCTIONS ─── */
function toggleTimer(matchId) {
  const match = state.matches.find(m => m.id === matchId);
  if (match && match.winnerSide) return;

  if (!state.timers[matchId]) {
    state.timers[matchId] = { running: false, elapsed: 0, startTime: null, finalElapsed: null, started: false };
  }
  const timer = state.timers[matchId];

  if (match && match.winnerSide) return;

  if (!timer.running) {
    timer.started = true;
    timer.running = true;
    timer.startTime = Date.now() - (timer.elapsed || 0) * 1000;
  } else {
    timer.running = false;
    timer.elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
    if (match && match.winnerSide) {
      timer.finalElapsed = timer.elapsed;
    }
  }
  saveState();
  renderMatches();
}

function resetTimer(matchId) {
  const match = state.matches.find(m => m.id === matchId);
  if (match && match.winnerSide) return;
  
  state.timers[matchId] = { running: false, elapsed: 0, startTime: null, finalElapsed: null, started: false };
  saveState();
  renderMatches();
}

function getTimerElapsed(matchId) {
  const timer = state.timers[matchId];
  if (!timer) return 0;
  const match = state.matches.find(m => m.id === matchId);
  if (match && match.winnerSide && timer.finalElapsed !== null && timer.finalElapsed !== undefined) {
    return timer.finalElapsed;
  }
  if (timer.running && timer.startTime) {
    return Math.floor((Date.now() - timer.startTime) / 1000);
  }
  return timer.elapsed || 0;
}

/* ─── SHARE: BUILD MATCH SUMMARY ─── */
function buildMatchSummary() {
  const completedMatches = state.matches.filter(m => m.winnerSide);
  if (completedMatches.length === 0) return '';

  let summary = '\n\nMATCH SUMMARY\n';
  summary += '─'.repeat(30) + '\n';

  completedMatches.forEach((m, idx) => {
    const scores = state.scores[m.id] || { sideA: 0, sideB: 0 };
    const isAWinner = m.winnerSide === 'A';
    const winningTeam = isAWinner ? m.sideA : m.sideB;
    const losingTeam = isAWinner ? m.sideB : m.sideA;
    
    const winningPlayers = winningTeam.label.split(' & ');
    const losingPlayers = losingTeam.label.split(' & ');
    const winningLabel = winningPlayers.join(' 🏆 ');
    const losingLabel = losingPlayers.join(' & ');
    
    const scoreA = scores.sideA;
    const scoreB = scores.sideB;
    
    summary += `Match ${idx + 1}\n`;
    summary += `${winningLabel} VS ${losingLabel}\n`;
    summary += `${scoreA} - ${scoreB}\n\n`;
  });

  return summary;
}

/* ─── RENDER HOME ─── */
function renderPlayerNameInputs(){
  const container = document.getElementById('playerNames');
  const n = Math.max(0, Math.min(40, Number(document.getElementById('numPlayers').value) || 0));
  const existing = state.playerNames || [];
  container.innerHTML = '';
  for(let i=0;i<n;i++){
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Player ${i+1}`;
    input.value = existing[i] || '';
    input.dataset.idx = i;
    container.appendChild(input);
  }
}

function updateRecommendation(){
  const numPlayers = Math.max(0, Number(document.getElementById('numPlayers').value) || 0);
  const durationValue = Number(document.getElementById('durationValue').value) || 0;
  const durationUnit = document.getElementById('durationUnit').value;
  const gamePoint = getGamePoint();
  const totalMinutes = durationUnit === 'hrs' ? durationValue*60 : durationValue;
  const estMatchMinutes = MatchEngine.matchMinutesForGamePoint(gamePoint);

  const countInput = document.getElementById('matchCount');
  const hint = document.getElementById('matchCountHint');

  if(numPlayers < 4){
    countInput.min = 0; countInput.max = 0; countInput.value = 0; countInput.disabled = true;
    hint.textContent = 'Need at least 4 players for doubles.';
    return;
  }

  countInput.disabled = false;
  countInput.min = 1;

  const recommendedPerPlayer = Math.max(2, Math.floor(totalMinutes / (estMatchMinutes + MatchEngine.TRANSITION_MINUTES) * 2 / numPlayers));
  const recommended = Math.max(4, Math.round(recommendedPerPlayer * numPlayers / 2));
  const maxMatches = Math.floor(totalMinutes / (estMatchMinutes + MatchEngine.TRANSITION_MINUTES)) || 1;

  countInput.max = Math.min(maxMatches, 50);
  countInput.value = Math.min(Math.max(countInput.value || recommended, 1), countInput.max);

  hint.textContent = `Recommended: ${recommended} matches (${Math.round(recommended * 2 / numPlayers)} matches per player). Max: ${countInput.max}`;
}

function renderHome(){
  document.getElementById('numPlayers').value = state.config.numPlayers;
  document.getElementById('durationValue').value = state.config.durationValue;
  document.getElementById('durationUnit').value = state.config.durationUnit;
  document.querySelectorAll('#gamePointSegmented button').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.point) === state.config.gamePoint));
  renderPlayerNameInputs();
  updateRecommendation();
  document.getElementById('homeHeading').textContent = state.generated ? 'Update Schedule' : 'Fair 2v2 Schedule';
  document.getElementById('generateBtn').textContent = state.generated ? 'Regenerate Balanced Schedule' : 'Generate Balanced Schedule';

  const banner = document.getElementById('homeBanner');
  banner.innerHTML = '';
  if(!storageAvailable){
    const div = document.createElement('div');
    div.className = 'banner banner-warning';
    div.textContent = 'Local storage is blocked. Results won\'t persist across refreshes.';
    banner.appendChild(div);
  }
  if(state.generated){
    const div = document.createElement('div');
    div.className = 'banner banner-warning';
    div.textContent = 'A schedule exists. Regenerating will clear all recorded results.';
    banner.appendChild(div);
  }
}

/* ─── RENDER MATCHES ─── */
function renderMatches(){
  const container = document.getElementById('matchesContent');
  container.innerHTML = '';

  if(!state.generated || state.matches.length === 0){
    const empty = document.createElement('div');
    empty.className = 'banner-empty';
    empty.innerHTML = `No matches yet. Head to <strong>Home</strong> to generate a balanced schedule.`;
    container.appendChild(empty);
    return;
  }

  if(state.warning){
    const warn = document.createElement('div');
    warn.className = 'banner banner-warning';
    warn.textContent = state.warning;
    container.appendChild(warn);
  }

  const flat = state.matches;
  const completed = flat.filter(m => m.winnerSide).length;
  const totalElapsed = flat.reduce((sum, m) => sum + getTimerElapsed(m.id), 0);

  const scoreboard = document.createElement('div');
  scoreboard.className = 'scoreboard';
  scoreboard.innerHTML = `
    <div class="scoreboard__cell">
      <div class="scoreboard__label">Game Point</div>
      <div class="scoreboard__value">${state.config.gamePoint}</div>
    </div>
    <div class="scoreboard__cell">
      <div class="scoreboard__label">Match Length</div>
      <div class="scoreboard__value">${state.matchMinutes} min</div>
    </div>
    <div class="scoreboard__cell">
      <div class="scoreboard__label">Completed</div>
      <div class="scoreboard__value">${completed}/${flat.length}</div>
    </div>
    <div class="scoreboard__cell">
      <div class="scoreboard__label">Total Time</div>
      <div class="scoreboard__value">${formatTimer(totalElapsed)}</div>
    </div>
  `;
  container.appendChild(scoreboard);

  const grid = document.createElement('div');
  grid.className = 'match-grid';
  flat.forEach(match => grid.appendChild(renderMatchCard(match)));
  container.appendChild(grid);

  if (window._timerInterval) clearInterval(window._timerInterval);
  window._timerInterval = setInterval(() => {
    let hasRunning = false;
    for (const mid in state.timers) {
      if (state.timers[mid] && state.timers[mid].running) {
        hasRunning = true;
        break;
      }
    }
    if (hasRunning) {
      document.querySelectorAll('.timer-display').forEach(el => {
        const matchId = el.dataset.matchId;
        if (matchId) {
          const elapsed = getTimerElapsed(matchId);
          el.textContent = formatTimer(elapsed);
        }
      });
    }
  }, 1000);
}

function renderMatchCard(match){
  const card = document.createElement('div');
  card.className = 'match-card' + (match.winnerSide ? ' decided' : '');
  
  const meta = document.createElement('div');
  meta.className = 'match-card__meta mono';
  
  const elapsed = getTimerElapsed(match.id);
  const timerData = state.timers[match.id] || { running: false };
  const isRunning = timerData.running;
  const isDecided = !!match.winnerSide;
  
  meta.innerHTML = `
    <span>${match.id.toUpperCase()}</span>
    <div class="match-card__timer">
      <span class="timer-display" data-match-id="${match.id}">${formatTimer(elapsed)}</span>
      <button class="timer-btn ${isRunning ? 'running' : ''}" data-match-id="${match.id}" ${isDecided ? 'disabled' : ''}>
        ${isDecided ? '✓' : (isRunning ? '⏹' : '▶')}
      </button>
      <button class="timer-btn" data-match-id="${match.id}" data-reset="true" ${isDecided ? 'disabled' : ''}>↺</button>
    </div>
  `;
  card.appendChild(meta);

  const timerBtn = meta.querySelector('.timer-btn:not([data-reset])');
  if (timerBtn) {
    timerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!match.winnerSide) toggleTimer(match.id);
    });
  }
  const resetBtn = meta.querySelector('.timer-btn[data-reset]');
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!match.winnerSide) resetTimer(match.id);
    });
  }

  const court = document.createElement('div');
  court.className = 'match-card__court';

  const gamePoint = state.config.gamePoint;
  const scores = state.scores[match.id] || { sideA: 0, sideB: 0 };
  const winner = match.winnerSide;

  const sideA = document.createElement('div');
  sideA.className = 'match-card__side' + (winner === 'A' ? ' winner' : (winner ? ' loser' : ''));
  if (!winner) {
    sideA.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      incrementScore(match.id, 'A');
    });
  }
  
  const scoreClassA = getScoreClass('A', scores.sideA, scores.sideB, gamePoint);
  sideA.innerHTML = `
    <span class="match-card__side-name">${match.sideA.label}</span>
    <span class="match-card__side-label">Team A</span>
    <input class="match-card__score ${scoreClassA} ${winner ? 'locked' : ''}" 
          type="number" 
          value="${scores.sideA}" 
          min="0" 
          data-match="${match.id}" data-side="A"
          ${winner ? 'readonly' : ''}
          ${!winner ? 'style="cursor:text;"' : ''}>
  `;
  const scoreInputA = sideA.querySelector('.match-card__score');
  scoreInputA.addEventListener('change', (e) => {
    updateScoreDirect(match.id, 'A', e.target.value);
  });
  scoreInputA.addEventListener('click', (e) => e.stopPropagation());

  const net = document.createElement('div');
  net.className = 'match-card__net';

  const sideB = document.createElement('div');
  sideB.className = 'match-card__side' + (winner === 'B' ? ' winner' : (winner ? ' loser' : ''));
  if (!winner) {
    sideB.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      incrementScore(match.id, 'B');
    });
  }
  
  const scoreClassB = getScoreClass('B', scores.sideB, scores.sideA, gamePoint);
  sideB.innerHTML = `
    <span class="match-card__side-name">${match.sideB.label}</span>
    <span class="match-card__side-label">Team B</span>
    <input class="match-card__score ${scoreClassB} ${winner ? 'locked' : ''}" 
          type="number" 
          value="${scores.sideB}" 
          min="0" 
          data-match="${match.id}" data-side="B"
          ${winner ? 'readonly' : ''}
          ${!winner ? 'style="cursor:text;"' : ''}>
  `;
  const scoreInputB = sideB.querySelector('.match-card__score');
  scoreInputB.addEventListener('change', (e) => {
    updateScoreDirect(match.id, 'B', e.target.value);
  });
  scoreInputB.addEventListener('click', (e) => e.stopPropagation());

  court.appendChild(sideA);
  court.appendChild(net);
  court.appendChild(sideB);
  card.appendChild(court);

  const actions = document.createElement('div');
  actions.className = 'match-card__actions';

  if (winner) {
    const winnerLabel = document.createElement('span');
    winnerLabel.style.cssText = 'padding: 10px 14px; color: var(--accent); font-size: 13px; font-weight: 600; flex: 1;';
    winnerLabel.textContent = `🏸 ${winner === 'A' ? match.sideA.label : match.sideB.label} won!`;
    actions.appendChild(winnerLabel);
  } else {
    const btnA = document.createElement('button');
    btnA.className = 'btn btn-ghost btn-sm';
    btnA.textContent = `🏸 ${match.sideA.label.split(' & ')[0]} wins`;
    btnA.addEventListener('click', () => {
      const currentScores = state.scores[match.id] || { sideA: 0, sideB: 0 };
      const gamePoint = state.config.gamePoint;
      
      if (currentScores.sideA === 0 && currentScores.sideB === 0) {
        ensureTimerStarted(match.id);
      }

      // Check if A already has a legal win condition
      if (checkWinCondition(currentScores.sideA, currentScores.sideB, gamePoint) === 'A') {
        match.winnerSide = 'A';
      } else {
        // Force A to win by setting score to the minimum winning score
        // If B is at gamePoint or higher, A needs B's score + 2
        if (currentScores.sideB >= gamePoint) {
          currentScores.sideA = currentScores.sideB + 2;
        } else {
          // Otherwise A wins at gamePoint + 1
          // But if B is at gamePoint - 1, A needs to win by 2, so gamePoint + 1
          currentScores.sideA = gamePoint + 1;
          // Ensure lead of at least 2
          if (currentScores.sideA - currentScores.sideB < 2) {
            currentScores.sideA = currentScores.sideB + 2;
          }
        }
        state.scores[match.id] = currentScores;
        match.winnerSide = 'A';
      }
      if (state.timers[match.id]) {
        const currentElapsed = getTimerElapsed(match.id);
        if (state.timers[match.id].running) {
          state.timers[match.id].running = false;
        }
        state.timers[match.id].finalElapsed = currentElapsed;
        state.timers[match.id].elapsed = currentElapsed;
      }
      saveState();
      renderMatches();
      renderLeaderboard();
    });

    const btnB = document.createElement('button');
    btnB.className = 'btn btn-ghost btn-sm';
    btnB.textContent = `🏸 ${match.sideB.label.split(' & ')[0]} wins`;
    btnB.addEventListener('click', () => {
      const currentScores = state.scores[match.id] || { sideA: 0, sideB: 0 };
      const gamePoint = state.config.gamePoint;
      
      if (currentScores.sideA === 0 && currentScores.sideB === 0) {
        ensureTimerStarted(match.id);
      }

      if (checkWinCondition(currentScores.sideA, currentScores.sideB, gamePoint) === 'B') {
        match.winnerSide = 'B';
      } else {
        if (currentScores.sideA >= gamePoint) {
          currentScores.sideB = currentScores.sideA + 2;
        } else {
          currentScores.sideB = gamePoint + 1;
          if (currentScores.sideB - currentScores.sideA < 2) {
            currentScores.sideB = currentScores.sideA + 2;
          }
        }
        state.scores[match.id] = currentScores;
        match.winnerSide = 'B';
      }
      if (state.timers[match.id]) {
        const currentElapsed = getTimerElapsed(match.id);
        if (state.timers[match.id].running) {
          state.timers[match.id].running = false;
        }
        state.timers[match.id].finalElapsed = currentElapsed;
        state.timers[match.id].elapsed = currentElapsed;
      }
      saveState();
      renderMatches();
      renderLeaderboard();
    });

    actions.appendChild(btnA);
    actions.appendChild(btnB);
  }

  card.appendChild(actions);
  return card;
}

function getScoreClass(side, score, opponentScore, gamePoint) {
  const status = getScoreStatus(
    side === 'A' ? score : opponentScore,
    side === 'B' ? score : opponentScore,
    gamePoint
  );
  
  if (status.status === 'won') {
    return status.winner === side ? 'winning' : 'losing';
  }
  if (status.status === 'deuce') return 'deuce';
  if (status.status === 'advantage') {
    return status.leader === side ? 'advantage' : 'match-point';
  }
  if (status.status === 'matchPoint') {
    return status.player === side ? 'match-point' : '';
  }
  return '';
}

/* ─── RENDER LEADERBOARD ─── */
function computeLeaderboard(){
  const stats = {};
  state.players.forEach(p => { stats[p.id] = { name: p.name, wins:0, losses:0, played:0 }; });

  state.matches.forEach(m => {
    if(!m.winnerSide) return;
    const winningIds = m.winnerSide === 'A' ? m.sideA.playerIds : m.sideB.playerIds;
    const losingIds = m.winnerSide === 'A' ? m.sideB.playerIds : m.sideA.playerIds;
    winningIds.forEach(id => { if(stats[id]){ stats[id].wins++; stats[id].played++; } });
    losingIds.forEach(id => { if(stats[id]){ stats[id].losses++; stats[id].played++; } });
  });

  return Object.values(stats).sort((a,b) => b.wins - a.wins || a.losses - b.losses);
}

function renderLeaderboard(){
  const container = document.getElementById('leaderboardContent');
  container.innerHTML = '';

  if(!state.generated || state.players.length === 0){
    const empty = document.createElement('div');
    empty.className = 'banner-empty';
    empty.innerHTML = `No standings yet. Generate a balanced schedule first.`;
    container.appendChild(empty);
    return;
  }

  const standings = computeLeaderboard();
  const table = document.createElement('table');
  table.className = 'leaderboard-table';
  table.innerHTML = `<thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Played</th><th>Win %</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  standings.forEach((s, idx) => {
    const pct = s.played ? Math.round((s.wins/s.played)*100) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="rank">${idx+1}</td><td>${s.name}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.played}</td><td class="win-pct">${s.played ? pct + '%' : '—'}</td>`;
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.className = 'leaderboard-wrap';
  wrap.appendChild(table);
  container.appendChild(wrap);

  const summary = buildMatchSummary();
  if (summary) {
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'match-summary';
    summaryDiv.innerHTML = `<h3>📋 Match Summary</h3>`;
    
    const completedMatches = state.matches.filter(m => m.winnerSide);
    completedMatches.forEach((m, idx) => {
      const scores = state.scores[m.id] || { sideA: 0, sideB: 0 };
      const isAWinner = m.winnerSide === 'A';
      const winningTeam = isAWinner ? m.sideA : m.sideB;
      const losingTeam = isAWinner ? m.sideB : m.sideA;
      
      const winningPlayers = winningTeam.label.split(' & ');
      const losingPlayers = losingTeam.label.split(' & ');
      const winningLabel = winningPlayers.join(' 🏆 ');
      const losingLabel = losingPlayers.join(' & ');
      
      const item = document.createElement('div');
      item.className = 'match-summary-item';
      item.innerHTML = `
        <span class="teams">${winningLabel} VS ${losingLabel}</span>
        <span class="score">${scores.sideA} - ${scores.sideB}</span>
      `;
      summaryDiv.appendChild(item);
    });
    
    container.appendChild(summaryDiv);
  }
}

/* ─── SHARE ─── */
function buildFullShareText() {
  const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const standings = computeLeaderboard();
  let text = `🏸 Balanced Match Results — ${date}\n\n`;
  text += 'LEADERBOARD\n';
  text += '─'.repeat(20) + '\n';
  const medals = ['🥇','🥈','🥉'];
  standings.forEach((s, i) => {
    const medal = i < 3 ? medals[i] : `${i+1}.`;
    text += `${medal} ${s.name} — ${s.wins}W, ${s.losses}L\n`;
  });
  
  const summary = buildMatchSummary();
  if (summary) {
    text += summary;
  }
  
  const totalMatches = state.matches.filter(m => m.winnerSide).length;
  text += `\nTotal Matches: ${totalMatches}`;
  if(state.balanceStats) {
    text += `\nBalance: ${state.balanceStats.minMatches}–${state.balanceStats.maxMatches} matches per player`;
  }
  return text;
}

function shareResults(){
  const text = buildFullShareText();
  if(navigator.share){
    navigator.share({ title: 'Badminton Results', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => {
      alert('Results copied to clipboard!');
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); alert('Results copied to clipboard!'); } catch(e) { alert('Copy failed. Please copy manually.'); }
      document.body.removeChild(textarea);
    });
  }
}

/* ─── VIEW SWITCHING ─── */
function setView(view){
  state.currentView = view;
  saveState();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.navbar__item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  if(view === 'home') renderHome();
  if(view === 'matches') renderMatches();
  if(view === 'leaderboard') renderLeaderboard();
  closeNav();
}

function renderAll(){ renderHome(); renderMatches(); renderLeaderboard(); }

/* ─── NAV ─── */
const navMenu = document.getElementById('navMenu');
const navToggle = document.getElementById('navToggle');
function closeNav(){ navMenu.classList.remove('open'); navToggle.setAttribute('aria-expanded','false'); }
navToggle.addEventListener('click', (e) => { e.stopPropagation(); const isOpen = navMenu.classList.toggle('open'); navToggle.setAttribute('aria-expanded', String(isOpen)); });
document.addEventListener('click', (e) => { if(!navMenu.contains(e.target)) closeNav(); });
document.querySelectorAll('.navbar__item[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

/* ─── RESET ─── */
document.getElementById('resetBtn').addEventListener('click', () => { closeNav(); if(confirm('Reset will permanently clear all data. Continue?')) resetState(); });

/* ─── THEME TOGGLE ─── */
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

/* ─── SHARE BUTTONS ─── */
document.getElementById('shareMatchesBtn').addEventListener('click', shareResults);
document.getElementById('shareLeaderboardBtn').addEventListener('click', shareResults);

/* ─── SETUP FORM ─── */
document.getElementById('numPlayers').addEventListener('input', () => { renderPlayerNameInputs(); updateRecommendation(); });
document.getElementById('durationValue').addEventListener('input', updateRecommendation);
document.getElementById('durationUnit').addEventListener('change', updateRecommendation);
document.querySelectorAll('#gamePointSegmented button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#gamePointSegmented button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateRecommendation();
  });
});

function showHomeBanner(message, type = 'warning'){
  const banner = document.getElementById('homeBanner');
  banner.innerHTML = '';
  const div = document.createElement('div');
  div.className = `banner banner-${type}`;
  div.innerHTML = message;
  banner.appendChild(div);
}

function setGamePoint(point){
  document.querySelectorAll('#gamePointSegmented button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.point) === Number(point));
  });
}

function applySchedulePromptConfig(config){
  const numPlayers = Math.max(4, Math.min(40, Number(config.numPlayers) || state.config.numPlayers || 6));
  const durationValue = Math.max(1, Number(config.durationValue) || state.config.durationValue || 2);
  const durationUnit = config.durationUnit === 'min' ? 'min' : 'hrs';
  const gamePoint = Number(config.gamePoint) === 15 ? 15 : 21;

  document.getElementById('numPlayers').value = numPlayers;
  document.getElementById('durationValue').value = durationValue;
  document.getElementById('durationUnit').value = durationUnit;
  setGamePoint(gamePoint);

  state.playerNames = Array.isArray(config.playerNames) ? config.playerNames.slice(0, numPlayers) : [];
  renderPlayerNameInputs();
  updateRecommendation();

  const matchInput = document.getElementById('matchCount');
  const requestedMatches = Math.max(1, Number(config.matchCount) || Number(matchInput.value) || 1);
  const maxMatches = Number(matchInput.max) || 50;
  matchInput.value = Math.min(requestedMatches, maxMatches);

  if(config.note){
    showHomeBanner(config.note, 'success');
  }
}

function currentSchedulePromptContext(){
  return {
    currentConfig: {
      numPlayers: Number(document.getElementById('numPlayers').value),
      durationValue: Number(document.getElementById('durationValue').value),
      durationUnit: document.getElementById('durationUnit').value,
      gamePoint: getGamePoint(),
      matchCount: Number(document.getElementById('matchCount').value)
    },
    currentPlayerNames: Array.from(document.querySelectorAll('#playerNames input')).map(input => input.value.trim()).filter(Boolean)
  };
}

async function generateFromPrompt(){
  const prompt = document.getElementById('schedulePrompt').value.trim();
  if(!prompt){
    showHomeBanner('Describe the session first, then I can generate the schedule setup.', 'error');
    return;
  }

  const btn = document.getElementById('generateFromPromptBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  showHomeBanner('Reading your prompt and preparing the schedule...', 'warning');

  try {
    const context = currentSchedulePromptContext();
    const response = await fetch('/api/ai/schedule-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...context })
    });

    const body = await response.json().catch(() => ({}));
    if(!response.ok){
      throw new Error(body.error || 'AI schedule generation failed.');
    }

    applySchedulePromptConfig(body);
    generateScheduleFromForm();
  } catch(error) {
    showHomeBanner(error.message || 'Could not generate from prompt.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate From Prompt';
  }
}

function generateScheduleFromForm(){
  const numPlayers = Number(document.getElementById('numPlayers').value);
  const durationValue = Number(document.getElementById('durationValue').value);
  const durationUnit = document.getElementById('durationUnit').value;
  const gamePoint = getGamePoint();
  const matchCount = Number(document.getElementById('matchCount').value);
  const banner = document.getElementById('homeBanner');
  banner.innerHTML = '';

  const errors = [];
  if(!Number.isInteger(numPlayers) || numPlayers < 4) errors.push('Need at least 4 players for doubles.');
  if(!durationValue || durationValue <= 0) errors.push('Enter a total duration greater than 0.');
  if(!matchCount || matchCount < 1) errors.push('Choose at least 1 match to schedule.');

  if(errors.length){
    const div = document.createElement('div');
    div.className = 'banner banner-error';
    div.innerHTML = errors.join('<br>');
    banner.appendChild(div);
    return;
  }

  if(state.generated){
    if(!confirm('This will reshuffle pairings and clear results. Continue?')) return;
  }

  const nameInputs = Array.from(document.querySelectorAll('#playerNames input'));
  const playerNames = nameInputs.map((inp, i) => inp.value.trim() || `Player ${i+1}`);
  const players = playerNames.map((name, i) => ({ id: 'p'+(i+1), name }));

  const config = { numPlayers, durationValue, durationUnit, gamePoint, matchCount };
  const result = MatchEngine.generateBalanced(config, players);

  state.config = config;
  state.playerNames = playerNames;
  state.players = players;
  state.matches = result.matches;
  state.matchMinutes = result.matchMinutes;
  state.warning = result.warning;
  state.generated = true;
  state.balanceStats = result.balanceStats;
  state.scores = {};
  state.timers = {};

  saveState();
  setView('matches');
}

document.getElementById('generateFromPromptBtn').addEventListener('click', generateFromPrompt);

document.getElementById('setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  generateScheduleFromForm();
});

/* ─── INIT ─── */
(function init(){ applyTheme(); renderAll(); setView(state.currentView || 'home'); })();
