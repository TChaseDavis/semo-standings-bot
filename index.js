// SEMO — Multi-league Sleeper Standings (weekly images, separate channels)

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, AttachmentBuilder } = require('discord.js');
const cron = require('node-cron');
const { createCanvas } = require('canvas');

// prevent multiple weekly schedules
let SCHEDULED = false;

// ---- ENV ----
const TOKEN = process.env.DISCORD_TOKEN;
const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';

// ---- CONFIG: put each Sleeper league + its target Discord channel here ----
// Fill in the channelId for the Discord text channel to post into.
// Repeat for 5 leagues. Use your real leagueIds and channelIds.
const LEAGUES = [
  {
    name: 'SEMO Franchise',
    leagueId: '1182077216376463360',   // you provided this
    channelId: '1413169015135932446',   // right-click channel → Copy ID
  },
  {
    name: 'SEMO Cut Throat',
    leagueId: '1265028623119679488',
    channelId: '1414434118829211748',
  },
  {
    name: 'SEMO AGS',
    leagueId: '1187259077095075840',
    channelId: '1414434182767050872',
  },
  {
    name: 'SEMO Degentlemen',
    leagueId: '1264634888502378496',
    channelId: '1414434248294666373',
  },
  {
    name: 'SEMO Premo',
    leagueId: '1203462913814179840',
    channelId: '1414434311867727933',
  },
];

// ---- Discord client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,  // <-- new
    GatewayIntentBits.MessageContent  // <-- new
  ]
});

// ---- Helpers: format rows from Sleeper ----
function formatRows(rosters, users) {
  const userMap = new Map(users.map(u => [u.user_id, u.display_name || u.username || 'Team']));
  const rows = rosters.map(r => {
    const wins = r.settings?.wins ?? 0;
    const losses = r.settings?.losses ?? 0;
    const ties = r.settings?.ties ?? 0;
    const fpts = Number(r.settings?.fpts ?? 0) + Number((r.settings?.fpts_decimal ?? 0) / 100);
    return {
      team: userMap.get(r.owner_id) || `Team ${r.roster_id}`,
      record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
      pts: Math.round(fpts * 10) / 10,
      wins,
    };
  });

  // sort by wins, then by points
  rows.sort((a, b) => (b.wins - a.wins) || (b.pts - a.pts));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---- Render standings into a PNG ----
async function renderImage(title, rows) {
  const width = 900;
  const height = Math.max(260, 160 + rows.length * 56);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.fillText(title, 36, 64);

  // headers
  const y0 = 110;
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText('#', 48, y0);
  ctx.fillText('Team', 98, y0);
  ctx.fillText('Record', 560, y0);
  ctx.fillText('Pts', 720, y0);

  // divider
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(36, y0 + 12);
  ctx.lineTo(width - 36, y0 + 12);
  ctx.stroke();

  // rows
  let y = y0 + 44;
  rows.forEach((r, i) => {
    // zebra striping
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(36, y - 24, width - 72, 48);
    }

    // rank badge
    ctx.fillStyle = i < 3 ? '#22c55e' : '#94a3b8';
    ctx.beginPath();
    ctx.arc(60, y - 8, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px Arial';
    const rankText = String(r.rank);
    ctx.fillText(rankText, 60 - (rankText.length > 1 ? 6 : 3), y - 4);

    // team
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.fillText(r.team, 98, y);

    // record + points
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(r.record, 560, y);
    ctx.fillText(r.pts.toString(), 720, y);

    y += 56;
  });

  // timestamp
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px Arial';
  ctx.fillText(`Updated ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })}`, 36, height - 24);

  return canvas.toBuffer('image/png');
}

// ---- Sleeper fetch ----
async function fetchStandings(leagueId) {
  const [rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
  ]);
  if (!rostersRes.ok || !usersRes.ok) throw new Error('Sleeper API error');
  const [rosters, users] = await Promise.all([rostersRes.json(), usersRes.json()]);
  return formatRows(rosters, users);
}

// ---- Post one league ----
async function postLeague({ name, leagueId, channelId }) {
  try {
    const rows = await fetchStandings(leagueId);
    const png = await renderImage(`${name} — Standings`, rows);
    const file = new AttachmentBuilder(png, { name: 'standings.png' });

    const ch = await client.channels.fetch(channelId);
    if (!ch || ch.type !== ChannelType.GuildText) throw new Error('Bad channel');

    await ch.send({ content: '**Standings Update**', files: [file] });
    console.log(`[OK] Posted ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
  }
}

// ---- Post all leagues ----
async function postAllLeagues() {
  for (const lg of LEAGUES) {
    await postLeague(lg);
  }
}
// ---- LIVE STANDINGS (assume current leaders win this week) ----
function toFloat(v) { return Number(v ?? 0); }

function seasonPoints(roster) {
  const f = toFloat(roster.settings?.fpts);
  const fd = toFloat(roster.settings?.fpts_decimal) / 100;
  return f + fd;
}

// Pair matchups by matchup_id into [A,B]
function pairMatchups(matchups) {
  const map = new Map();
  for (const m of matchups) {
    if (!m.matchup_id) continue;
    if (!map.has(m.matchup_id)) map.set(m.matchup_id, []);
    map.get(m.matchup_id).push(m);
  }
  return [...map.values()].filter(p => p.length === 2);
}

async function fetchCurrentWeek() {
  const res = await fetch('https://api.sleeper.app/v1/state/nfl');
  const state = await res.json();
  return Number(state.week || 1);
}

/**
 * Build standings as-if the current week's matchups ended now.
 * Winner = team with higher 'points' in the current matchup; equals => tie.
 */
async function liveStandingsIfEndedNow(leagueId) {
  const [week, rostersRes, usersRes] = await Promise.all([
    fetchCurrentWeek(),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
  ]);
  const [rosters, users] = await Promise.all([rostersRes.json(), usersRes.json()]);

  // current week matchups
  const mRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
  const matchups = await mRes.json();

  const userMap = new Map(users.map(u => [u.user_id, u.display_name || u.username || 'Team']));
  const rosterById = new Map(rosters.map(r => [r.roster_id, r]));

  // start with base records + season points
  const rows = rosters.map(r => {
    const team = userMap.get(r.owner_id) || `Team ${r.roster_id}`;
    const sp = seasonPoints(r);
    return {
      roster_id: r.roster_id,
      team,
      wins:   r.settings?.wins   ?? 0,
      losses: r.settings?.losses ?? 0,
      ties:   r.settings?.ties   ?? 0,
      pts: Math.round(sp * 10) / 10
    };
  });
  const byRoster = new Map(rows.map(r => [r.roster_id, r]));

  // apply this week's hypothetical result
  for (const pair of pairMatchups(matchups)) {
    const [a, b] = pair;
    const rowA = byRoster.get(a.roster_id);
    const rowB = byRoster.get(b.roster_id);
    if (!rowA || !rowB) continue;

    const ptsA = toFloat(a.points);
    const ptsB = toFloat(b.points);

    if (ptsA > ptsB) { rowA.wins += 1; rowB.losses += 1; }
    else if (ptsB > ptsA) { rowB.wins += 1; rowA.losses += 1; }
    else { rowA.ties += 1; rowB.ties += 1; }
  }

  // final rows for rendering
  const finalRows = rows.map(r => ({
    team: r.team,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`,
    pts: r.pts
  }));

  finalRows.sort((a, b) => (b.wins - a.wins) || (b.pts - a.pts));
  finalRows.forEach((r, i) => (r.rank = i + 1));

  return { week, rows: finalRows };
}

async function handleLiveStandingsCommand(channel, leagueName, leagueId) {
  try {
    const { week, rows } = await liveStandingsIfEndedNow(leagueId);
    const png = await renderImage(`${leagueName} — Live Standings (if Week ${week} ended now)`, rows);
    const file = new AttachmentBuilder(png, { name: 'live-standings.png' });
    await channel.send({ content: '**Live Standings**', files: [file] });
  } catch (e) {
    await channel.send(`Sorry, couldn't compute live standings: ${e.message}`);
    console.error('[live standings error]', e);
  }
}

// ---- Boot & schedule ----
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // (Optional) immediate test once:
  // await postAllLeagues();

  // Weekly: Tuesdays at 07:00 Central
  // Cron: min hour day-of-month month day-of-week → '0 7 * * 2' == 07:00 every Tuesday
  cron.schedule('0 7 * * 2', () => {
    console.log('Cron: posting weekly standings for all leagues…');
    postAllLeagues();
  }, { timezone: TIMEZONE });

  console.log(`Scheduled weekly posts for all leagues: Tuesdays 7:00 AM (${TIMEZONE})`);
});

// Map channelId -> league config for quick lookup
const LEAGUE_BY_CHANNEL = new Map(LEAGUES.map(lg => [String(lg.channelId), lg]));

// Accept a couple aliases and ignore case/extra spaces
function isLiveCmd(s) {
  const t = s.trim().toLowerCase();
  return t === '!livestandings' || t === '!live';
}

// ---- Boot & schedule ----
client.once('ready', () => {
  if (SCHEDULED) {
    console.log('⏭️  Schedule already active, skipping duplicate setup.');
    return;
  }
  SCHEDULED = true;

  console.log(`Logged in as ${client.user.tag}`);

  cron.schedule('0 7 * * 2', () => {
    console.log('🗓️ Cron: posting weekly standings for all leagues…');
    postAllLeagues();
  }, { timezone: TIMEZONE });

  console.log(`✅ Scheduled weekly posts for all leagues: Tuesdays 7:00 AM (${TIMEZONE})`);
});

// ---- Message listener (for !livestandings / !live) ----
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    // DEBUG (optional): log messages the bot sees
    // console.log(`[MSG] #${msg.channel?.name} (${msg.channelId}) ${msg.author.tag}: ${msg.content}`);

    if (!isLiveCmd(msg.content)) return;

    const lg = LEAGUE_BY_CHANNEL.get(String(msg.channelId));
    if (!lg) {
      await msg.reply('This channel isn’t linked to a league for live standings.');
      return;
    }

    await handleLiveStandingsCommand(msg.channel, lg.name, lg.leagueId);
  } catch (e) {
    console.error('message handler error:', e);
    try { await msg.reply('Something went wrong handling that command.'); } catch {}
  }
});

client.login(TOKEN);
