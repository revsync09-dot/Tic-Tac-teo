require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const GameEngine = require('./components/GameEngine');
const UIBuilder = require('./components/UIBuilder');

// ─── INIT ────────────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const games        = new Map();   // gameId → gameState
const cooldowns    = new Map();   // userId → expirationTimestamp
const activeUsers  = new Set();   // userIds in a game
const lockSet      = new Set();   // atomic move locks
const rematchPending = new Map(); // pairKey → { initiatorId, timer }
const challengesPending = new Map(); // targetId → { challengerId, timer, size }

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GUILD_ID       = process.env.GUILD_ID;
const GAME_CHANNEL_ID = '1498406160204828742'; 
const BYPASS_ROLE_ID  = '795466540140986368';
const AFK_WARNING_MS  = 45_000;
const AFK_FORFEIT_MS  = 60_000;
const COOLDOWN_MS     = 20_000; // 20 seconds — high frequency
const GAME_TTL_MS     = 300_000; // 5 min hard TTL

const EMOJIS = {
    X:       process.env.EMOJI_X       || '❌',
    O:       process.env.EMOJI_O       || '⭕',
    WIN:     process.env.EMOJI_WIN     || '🏆',
    RANK:    process.env.EMOJI_RANK    || '🏅',
    POINTS:  process.env.EMOJI_POINTS  || '💰',
    STREAK:  process.env.EMOJI_STREAK  || '🔥',
    REMATCH: process.env.EMOJI_REMATCH || '🎮',
    DRAW:    process.env.EMOJI_DRAW    || '🤝',
    CROWN:   process.env.EMOJI_CROWN   || process.env.EMOJI_WIN || '1482120473251807302',
    SUCCESS: process.env.EMOJI_SUCCESS || '1480578220003819726', 
    ERROR:   process.env.EMOJI_ERROR   || '❌',
    EMPTY:   process.env.EMOJI_EMPTY   || '➖',
    STATS:   process.env.EMOJI_STATS   || '1480578098952142999'
};

const UI = new UIBuilder(EMOJIS, client);

// ─── EVENTS ──────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`🚀 TIC TAC TEO V2.1 [MULTI-GRID] ACTIVE AS ${client.user.tag}!`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        console.log(`✅ SYNCED: ${guild.name} (${guild.emojis.cache.size} emojis)`);
    }
});

client.on('interactionCreate', async interaction => {
    try {
        // ── SLASH COMMANDS ───────────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            if (interaction.channelId !== GAME_CHANNEL_ID && !interaction.member.roles.cache.has(BYPASS_ROLE_ID)) {
                return interaction.reply({
                    content: `🚫 **Wrong Channel!** Use <#${GAME_CHANNEL_ID}>.`,
                    ephemeral: true
                }).catch(() => null);
            }

            const { commandName } = interaction;

            if (commandName === 'tictactoe') {
                const now = Date.now();
                const cd = cooldowns.get(interaction.user.id) || 0;
                if (now < cd) {
                    return interaction.reply({ content: `⏳ Cooldown! Wait **${Math.ceil((cd - now) / 1000)}s**.`, ephemeral: true }).catch(() => null);
                }

                const opponent = interaction.options.getUser('opponent');
                const size = interaction.options.getInteger('size') || 3;
                if (!opponent || opponent.bot || opponent.id === interaction.user.id) {
                    return interaction.reply({ content: '❌ Invalid opponent.', ephemeral: true }).catch(() => null);
                }

                if (activeUsers.has(interaction.user.id) || activeUsers.has(opponent.id)) {
                    return interaction.reply({ content: '⚔️ Someone is already in a game!', ephemeral: true }).catch(() => null);
                }

                cooldowns.set(interaction.user.id, now + COOLDOWN_MS);
                
                const challengeEmbed = UI.createChallengeEmbed(interaction.user, opponent);
                challengeEmbed.addFields({ name: '📏 Board Size', value: `**${size}x${size}**`, inline: true });
                const row = UI.createChallengeButtons(interaction.user.id, opponent.id);

                await interaction.reply({ content: `⚔️ <@${opponent.id}>, you have been challenged!`, embeds: [challengeEmbed], components: [row] });

                const timer = setTimeout(() => {
                    if (challengesPending.has(opponent.id)) {
                        challengesPending.delete(opponent.id);
                        interaction.editReply({ content: '⏳ Challenge expired.', embeds: [], components: [] }).catch(() => null);
                    }
                }, 60_000);

                challengesPending.set(opponent.id, { challengerId: interaction.user.id, timer, size });
            }

            if (commandName === 'leaderboard') {
                await interaction.reply({ content: '🏆 Loading Hall of Legends...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest] = await Promise.all([db.getLeaderboard(), db.getStrongestPlayer()]);
                    const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                    const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id);
                    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard_v2.png' });
                    await interaction.editReply({ content: null, embeds: [], files: [attachment] });
                } catch (err) {
                    await interaction.editReply({ content: '❌ Could not load leaderboard.' }).catch(() => null);
                }
            }

            if (commandName === 'weekly') {
                await interaction.reply({ content: '🔥 Loading Weekly Top Warriors...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest] = await Promise.all([db.getWeeklyLeaderboard(), db.getStrongestPlayer()]);
                    const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                    const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id, 'WEEKLY RANKINGS');
                    const attachment = new AttachmentBuilder(buffer, { name: 'weekly_v2.png' });
                    await interaction.editReply({ content: null, embeds: [], files: [attachment] });
                } catch (err) {
                    await interaction.editReply({ content: '❌ Could not load weekly leaderboard.' }).catch(() => null);
                }
            }

            if (commandName === 'profile') {
                const target = interaction.options.getUser('user') || interaction.user;
                await interaction.reply({ content: `📊 Loading profile for ${target.username}...`, ephemeral: false }).catch(() => null);
                try {
                    const [stats, globalRank] = await Promise.all([db.getUserStats(target.id), db.getUserRank(target.id)]);
                    if (!stats) return interaction.editReply({ content: 'No stats yet! Play a game first.' });
                    const rank = db.getRankTitle(stats.points);
                    const buffer = await GameEngine.renderProfileCard(target, stats, rank, globalRank);
                    const attachment = new AttachmentBuilder(buffer, { name: 'profile_v2.png' });
                    const embed = new EmbedBuilder().setColor(UI.getRank(stats.points).color).setTitle(`${target.username}'s Arena Profile`).setImage('attachment://profile_v2.png');
                    await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
                } catch (err) {
                    await interaction.editReply({ content: '❌ Could not load profile.' }).catch(() => null);
                }
            }

            if (commandName === 'rewards') {
                const embed = new EmbedBuilder().setColor('#ffd700').setTitle('💰 Arena Rewards System').setDescription(`🥇 **Weekly Champion:** 10,000 Points\n🥈 **Runner Up:** 5,000 Points\n🥉 **Third Place:** 2,500 Points\n\n📅 Reset: Every Monday 00:00 UTC.`);
                return interaction.reply({ embeds: [embed] }).catch(() => null);
            }
        }

        // ── BUTTONS & SELECT MENUS ──────────────────────────────────────────
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            
            if (interaction.isButton() && interaction.customId.startsWith('accept_battle_')) {
                const parts = interaction.customId.split('_');
                const challengerId = parts[2], targetId = parts[3];
                if (interaction.user.id !== targetId) return;
                const pending = challengesPending.get(targetId);
                if (!pending) return interaction.reply({ content: '⏳ Challenge expired.', ephemeral: true }).catch(() => null);
                clearTimeout(pending.timer);
                challengesPending.delete(targetId);
                await interaction.deferUpdate().catch(() => null);
                const challenger = await client.users.fetch(challengerId).catch(() => null);
                if (!challenger) return;
                const newCd = Date.now() + COOLDOWN_MS;
                cooldowns.set(challengerId, newCd); cooldowns.set(targetId, newCd);
                return startNewGame(interaction, challenger, pending.size);
            }

            if (interaction.isButton() && interaction.customId.startsWith('replay_')) {
                const parts = interaction.customId.split('_');
                const p1Id = parts[1], p2Id = parts[2], size = parseInt(parts[3] || 3);
                const clickerId = interaction.user.id;
                if (clickerId !== p1Id && clickerId !== p2Id) return;
                const pairKey = [p1Id, p2Id].sort().join('_');
                const opponentId = clickerId === p1Id ? p2Id : p1Id;
                const cd = cooldowns.get(clickerId) || 0;
                if (Date.now() < cd) return interaction.reply({ content: `⏳ Cooldown! Wait **${Math.ceil((cd - Date.now()) / 1000)}s**.`, ephemeral: true }).catch(() => null);
                if (rematchPending.has(pairKey)) {
                    const pending = rematchPending.get(pairKey);
                    if (pending.initiatorId === clickerId) return;
                    clearTimeout(pending.timer); rematchPending.delete(pairKey);
                    const opponent = await client.users.fetch(opponentId).catch(() => null);
                    return startNewGame(interaction, opponent, size);
                } else {
                    const timer = setTimeout(() => { rematchPending.delete(pairKey); }, 60_000);
                    rematchPending.set(pairKey, { initiatorId: clickerId, timer });
                    return interaction.reply({ content: `🎮 <@${clickerId}> wants a rematch (**${size}x${size}**)! <@${opponentId}> — click **Rematch**!`, ephemeral: false }).catch(() => null);
                }
            }

            const parts = interaction.customId.split('_');
            const [gameId, actionOrRow, col] = parts;
            const gameState = games.get(gameId);
            if (!gameState) return;

            const currentPlayer = gameState.players[gameState.turn];
            if (interaction.user.id !== currentPlayer.id) {
                return interaction.reply({ content: `🚫 **Not your turn!**`, ephemeral: true }).catch(() => null);
            }

            if (lockSet.has(gameId)) return interaction.deferUpdate().catch(() => null);

            let r, c;
            if (interaction.isStringSelectMenu()) {
                const val = parseInt(interaction.values[0]);
                if (actionOrRow === 'row') gameState.pendingRow = val;
                if (actionOrRow === 'col') gameState.pendingCol = val;
                if (gameState.pendingRow === null || gameState.pendingCol === null) return interaction.deferUpdate().catch(() => null);
                r = gameState.pendingRow; c = gameState.pendingCol;
                gameState.pendingRow = null; gameState.pendingCol = null;
            } else {
                r = parseInt(actionOrRow); c = parseInt(col);
            }

            if (isNaN(r) || isNaN(c)) return;
            if (gameState.board[r][c]) {
                if (interaction.isStringSelectMenu()) return interaction.reply({ content: '❌ Already taken!', ephemeral: true }).catch(() => null);
                return;
            }

            lockSet.add(gameId);
            await interaction.deferUpdate().catch(() => null);

            try {
                clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer);
                gameState.board[r][c] = gameState.turn;
                gameState.moveCount++;

                const winReq = gameState.board.length === 3 ? 3 : 5;
                const winnerKey = checkWinner(gameState.board, winReq);
                let resX, resO;

                if (winnerKey) {
                    gameState.winner = gameState.players[winnerKey];
                    const loserKey = winnerKey === 'X' ? 'O' : 'X';
                    [resX, resO] = await Promise.all([db.updateStats(gameState.players[winnerKey].id, 'win'), db.updateStats(gameState.players[loserKey].id, 'loss')]);
                } else if (isBoardFull(gameState.board)) {
                    gameState.isDraw = true;
                    [resX, resO] = await Promise.all([db.updateStats(gameState.players.X.id, 'draw'), db.updateStats(gameState.players.O.id, 'draw')]);
                } else {
                    gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
                }

                const strongest = await db.getStrongestPlayer();
                const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
                const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
                const embed = UI.createGameStatusEmbed(gameState.players.X, gameState.players.O, gameState.players[gameState.turn], gameState.winner, gameState.isDraw);

                await interaction.editReply({
                    content: null, embeds: [embed], files: [attachment],
                    components: UI.createGameComponents(gameState.board, !!(gameState.winner || gameState.isDraw), gameId)
                });

                if (gameState.winner || gameState.isDraw) {
                    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
                    const matchStats = { moves: gameState.moveCount, duration };
                    const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id, gameState.board.length);

                    if (gameState.winner) {
                        const winData = winnerKey === 'X' ? resX : resO;
                        const winEmbed = UI.createVictoryAnnouncement(gameState.winner, winData?.data?.current_streak || 1, winData?.data?.points || 0, matchStats);
                        await interaction.followUp({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);
                        if (winData?.rankUp) await interaction.followUp({ embeds: [UI.createRankUpAnnouncement(gameState.winner, winData.oldRank, winData.newRank)] }).catch(() => null);
                    } else {
                        await interaction.followUp({ embeds: [UI.createDrawAnnouncement(gameState.players.X, gameState.players.O)], components: [replayRow] }).catch(() => null);
                    }
                    cleanupGame(gameId);
                } else {
                    setupAfkTimers(gameState);
                }
            } finally { lockSet.delete(gameId); }
        }
    } catch (e) { console.error(e); }
});

async function startNewGame(interaction, opponent, size = 3) {
    try {
        const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
        await interaction[method]({ content: '🛡️ **Battle Loading...**', embeds: [], components: [], files: [] }).catch(() => null);
        const gameId = interaction.id;
        const playerX = interaction.user;
        const gameState = {
            id: gameId, players: { X: playerX, O: opponent },
            board: Array(size).fill(null).map(() => Array(size).fill(null)),
            turn: 'X', winner: null, isDraw: false, startTime: Date.now(), moveCount: 0,
            pendingRow: null, pendingCol: null
        };
        games.set(gameId, gameState); activeUsers.add(playerX.id); activeUsers.add(opponent.id);
        const strongest = await db.getStrongestPlayer();
        const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
        const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
        const embed = UI.createGameStatusEmbed(playerX, opponent, playerX);
        await interaction.editReply({ content: null, embeds: [embed], files: [attachment], components: UI.createGameComponents(gameState.board, false, gameId) });
        setupAfkTimers(gameState);
    } catch (e) { console.error(e); }
}

function setupAfkTimers(gs) {
    clearTimeout(gs.afkWarningTimer); clearTimeout(gs.afkForfeitTimer);
    gs.afkWarningTimer = setTimeout(async () => {
        const chan = client.channels.cache.get(GAME_CHANNEL_ID);
        if (chan) chan.send({ content: `⚠️ <@${gs.players[gs.turn].id}>, **45 seconds** passed! Move now or forfeit!` }).catch(() => null);
    }, AFK_WARNING_MS);
    gs.afkForfeitTimer = setTimeout(async () => {
        const next = gs.turn === 'X' ? 'O' : 'X';
        const winner = gs.players[next]; const loser = gs.players[gs.turn];
        await db.updateStats(winner.id, 'win'); await db.updateStats(loser.id, 'loss');
        const chan = client.channels.cache.get(GAME_CHANNEL_ID);
        if (chan) chan.send({ embeds: [UI.createAfkForfeit(loser, winner)], components: [UI.createReplayButton(gs.players.X.id, gs.players.O.id, gs.board.length)] }).catch(() => null);
        cleanupGame(gs.id);
    }, AFK_FORFEIT_MS);
}

function cleanupGame(gameId) {
    const gs = games.get(gameId);
    if (gs) {
        activeUsers.delete(gs.players.X.id); activeUsers.delete(gs.players.O.id);
        clearTimeout(gs.afkWarningTimer); clearTimeout(gs.afkForfeitTimer);
        games.delete(gameId);
    }
}

function checkWinner(board, winReq = 3) {
    const size = board.length;
    function checkLine(r, c, dr, dc) {
        const first = board[r][c]; if (!first) return null;
        for (let i = 1; i < winReq; i++) {
            const nr = r + dr * i, nc = c + dc * i;
            if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== first) return null;
        }
        return first;
    }
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (checkLine(r, c, 0, 1) || checkLine(r, c, 1, 0) || checkLine(r, c, 1, 1) || checkLine(r, c, 1, -1)) return board[r][c];
        }
    }
    return null;
}

function isBoardFull(board) { return board.every(row => row.every(cell => cell !== null)); }

client.login(process.env.TOKEN);
