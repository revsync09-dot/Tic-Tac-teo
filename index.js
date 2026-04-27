require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require('discord.js');

const GameEngine = require('./components/GameEngine');
const UIBuilder = require('./components/UIBuilder');
const db = require('./db');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers],
    failIfNotExists: false
});

client.on('error', e => console.error('🛡️ CLIENT ERROR:', e));
process.on('unhandledRejection', e => console.error('🛡️ UNHANDLED REJECTION:', e));
process.on('uncaughtException', e => console.error('🛡️ UNCAUGHT EXCEPTION:', e));

// ─── CONCURRENCY STATE ───────────────────────────────────────────────────────
const games        = new Map();   // gameId → gameState
const cooldowns    = new Map();   // userId → expiresAt (ms)
const activeUsers  = new Set();   // userIds in a game
const lockSet      = new Set();   // atomic move locks
const rematchPending = new Map(); // pairKey → { initiatorId, timer }
const challengesPending = new Map(); // targetId → { challengerId, timer }

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GUILD_ID       = process.env.GUILD_ID;
const GAME_CHANNEL_ID = '1498406160204828742';
const BYPASS_ROLE_ID  = '795466540140986368';
const AFK_WARNING_MS  = 45_000;
const AFK_FORFEIT_MS  = 60_000;
const COOLDOWN_MS     = 60_000; // 1 minute — balanced
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

// ─── STRONGEST PLAYER CACHE (30s TTL) ───────────────────────────────────────
let strongestCache = { data: null, fetchedAt: 0 };
async function getStrongestCached() {
    const now = Date.now();
    if (now - strongestCache.fetchedAt < 30_000 && strongestCache.data !== undefined) {
        return strongestCache.data;
    }
    const data = await db.getStrongestPlayer();
    strongestCache = { data, fetchedAt: now };
    return data;
}

// ─── COOLDOWN CLEANUP (every 60s, prevents memory leak at 3k users) ──────────
setInterval(() => {
    const now = Date.now();
    for (const [userId, exp] of cooldowns) {
        if (now >= exp) cooldowns.delete(userId);
    }
}, 60_000);

// ─── GAME CLEANUP HELPER ──────────────────────────────────────────────────────
function cleanupGame(gameId) {
    const gs = games.get(gameId);
    if (!gs) return;
    clearTimeout(gs.afkWarningTimer);
    clearTimeout(gs.afkForfeitTimer);
    clearTimeout(gs.masterTimer);
    activeUsers.delete(gs.players.X.id);
    activeUsers.delete(gs.players.O.id);
    lockSet.delete(gameId);
    games.delete(gameId);
}

// ─── ON READY ────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`🚀 TIC TAC TEO V2.1 [NOKIA MODE] ACTIVE AS ${client.user.tag}!`);
    if (GUILD_ID) {
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            await guild.emojis.fetch();
            console.log(`✅ SYNCED: ${guild.name} (${guild.emojis.cache.size} emojis)`);
        } catch (e) { console.error('❌ SYNC FAIL:', e.message); }
    }
    console.log('📦 PRE-CACHING...');
    await Promise.all([EMOJIS.X, EMOJIS.O, EMOJIS.CROWN, EMOJIS.SUCCESS, EMOJIS.ERROR]
        .map(e => GameEngine.getEmojiImage(e)));
    console.log('💎 ASSETS READY!');
    console.log(`📊 Games Map: ${games.size} | ActiveUsers: ${activeUsers.size}`);
});

// ─── INTERACTION HANDLER ─────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    try {
        // ── SLASH COMMANDS ────────────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const hasBypass = interaction.member?.roles?.cache?.has(BYPASS_ROLE_ID);
            if (!hasBypass && interaction.channelId !== GAME_CHANNEL_ID) {
                return interaction.reply({
                    content: `🚫 **Wrong Channel!** Use <#${GAME_CHANNEL_ID}>.`,
                    ephemeral: true
                }).catch(() => null);
            }

            const { commandName } = interaction;

            // /tictactoe
            if (commandName === 'tictactoe') {
                const now = Date.now();
                const cd = cooldowns.get(interaction.user.id) || 0;
                if (now < cd) {
                    return interaction.reply({
                        content: `⏳ Cooldown! Wait **${Math.ceil((cd - now) / 1000)}s**.`,
                        ephemeral: true
                    }).catch(() => null);
                }

                const opponent = interaction.options.getUser('opponent');
                if (!opponent || opponent.bot || opponent.id === interaction.user.id) {
                    return interaction.reply({ content: '❌ Invalid opponent.', ephemeral: true }).catch(() => null);
                }

                // Per-user active game guard
                if (activeUsers.has(interaction.user.id)) {
                    return interaction.reply({ content: '⚔️ You are already in a game! Finish it first.', ephemeral: true }).catch(() => null);
                }
                if (activeUsers.has(opponent.id)) {
                    return interaction.reply({ content: `⚔️ <@${opponent.id}> is already in a game!`, ephemeral: true }).catch(() => null);
                }

                const newCd = now + COOLDOWN_MS;
                cooldowns.set(interaction.user.id, newCd);
                
                const challengeEmbed = UI.createChallengeEmbed(interaction.user, opponent);
                const row = UI.createChallengeButtons(interaction.user.id, opponent.id);

                await interaction.reply({
                    content: `⚔️ <@${opponent.id}>, you have been challenged!`,
                    embeds: [challengeEmbed],
                    components: [row]
                });

                // Challenge expires in 60s
                const timer = setTimeout(() => {
                    if (challengesPending.has(opponent.id)) {
                        challengesPending.delete(opponent.id);
                        interaction.editReply({ content: '⏳ Challenge expired.', embeds: [], components: [] }).catch(() => null);
                    }
                }, 60_000);

                challengesPending.set(opponent.id, { challengerId: interaction.user.id, timer });
            }
            // /weekly
            if (commandName === 'weekly') {
                await interaction.reply({ content: '🔥 Loading the Weekly Top Warriors...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest] = await Promise.all([
                        db.getWeeklyLeaderboard(), db.getStrongestPlayer()
                    ]);
                    const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                    const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id, 'WEEKLY RANKINGS');
                    const attachment = new AttachmentBuilder(buffer, { name: 'weekly_v2.png' });
                    await interaction.editReply({ content: null, embeds: [], files: [attachment] });
                } catch (err) {
                    console.error('[Weekly Error]', err.message);
                    await interaction.editReply({ content: '❌ Could not load weekly leaderboard.' }).catch(() => null);
                }
            }

            // /rewards
            if (commandName === 'rewards') {
                const embed = new EmbedBuilder()
                    .setColor('#ffd700')
                    .setTitle('💰 Arena Rewards System')
                    .setDescription(
                        `🥇 **Weekly Champion:** 10,000 Points + Custom Role\n` +
                        `🥈 **Runner Up:** 5,000 Points\n` +
                        `🥉 **Third Place:** 2,500 Points\n\n` +
                        `📅 **Reset Info:** Weekly points reset every Monday at 00:00 UTC.\n` +
                        `🏆 *Monthly Rewards are coming soon! Keep climbing!*`
                    )
                    .setFooter({ text: 'Hyperions Arena • v2.1' });
                return interaction.reply({ embeds: [embed] }).catch(() => null);
            }

            // /leaderboard
            if (commandName === 'leaderboard') {
                await interaction.reply({ content: '🏆 Loading Hall of Legends...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest] = await Promise.all([
                        db.getLeaderboard(), db.getStrongestPlayer()
                    ]);
                    const userData = await Promise.all(
                        topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null))
                    );
                    const buffer = await GameEngine.renderLeaderboard(
                        topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id
                    );
                    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard_v2.png' });
                    await interaction.editReply({ content: null, embeds: [], files: [attachment] });
                } catch (err) {
                    console.error('[LB Error]', err.message);
                    await interaction.editReply({ content: '❌ Could not load leaderboard.' }).catch(() => null);
                }
            }

            // /profile
            if (commandName === 'profile') {
                const emojiStats = UI.formatEmoji(EMOJIS.STATS, '📊');
                await interaction.reply({ content: `${emojiStats} Loading profile...`, ephemeral: false }).catch(() => null);
                try {
                    const target = interaction.options.getUser('user') || interaction.user;
                    const [stats, globalRank] = await Promise.all([
                        db.getUserStats(target.id),
                        db.getUserRank(target.id)
                    ]);
                    if (!stats) {
                        return interaction.editReply({ content: `<@${target.id}> has no stats yet. Play a game first!` }).catch(() => null);
                    }
                    const rank = db.getRankTitle(stats.points);
                    const buffer = await GameEngine.renderProfileCard(target, stats, rank, globalRank);
                    const attachment = new AttachmentBuilder(buffer, { name: 'profile_v2.png' });
                    const embed = new EmbedBuilder()
                        .setColor(UI.getRank(stats.points).color)
                        .setTitle(`${target.username}'s Arena Profile`)
                        .setImage('attachment://profile_v2.png')
                        .setFooter({ text: 'Hyperions Arena • v2.1' });
                    await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
                } catch (err) {
                    console.error('[Profile Error]', err.message);
                    await interaction.editReply({ content: '❌ Could not load profile.' }).catch(() => null);
                }
            }
        }

        // ── BUTTONS ───────────────────────────────────────────────────────────
        if (interaction.isButton()) {

            // ACCEPT BATTLE button
            if (interaction.customId.startsWith('accept_battle_')) {
                const parts = interaction.customId.split('_');
                const challengerId = parts[2], targetId = parts[3];
                
                if (interaction.user.id !== targetId) {
                    return interaction.reply({ content: '❌ You are not the target of this challenge!', ephemeral: true }).catch(() => null);
                }

                if (!challengesPending.has(targetId)) {
                    return interaction.reply({ content: '⏳ Challenge expired or already accepted.', ephemeral: true }).catch(() => null);
                }

                const pending = challengesPending.get(targetId);
                clearTimeout(pending.timer);
                challengesPending.delete(targetId);

                if (activeUsers.has(challengerId) || activeUsers.has(targetId)) {
                    return interaction.reply({ content: '⚔️ One of the players is already in a game!', ephemeral: true }).catch(() => null);
                }

                await interaction.deferUpdate().catch(() => null);
                const challenger = await client.users.fetch(challengerId).catch(() => null);
                if (!challenger) return;

                // Set cooldown for BOTH on start
                const newCd = Date.now() + COOLDOWN_MS;
                cooldowns.set(challengerId, newCd);
                cooldowns.set(targetId, newCd);

                return startNewGame(interaction, challenger);
            }

            // REMATCH button — mutual confirmation required
            if (interaction.customId.startsWith('replay_')) {
                const parts  = interaction.customId.split('_');
                const p1Id   = parts[1], p2Id = parts[2];
                const clickerId = interaction.user.id;

                if (clickerId !== p1Id && clickerId !== p2Id) {
                    return interaction.reply({ content: '❌ Only the original players can request a rematch!', ephemeral: true }).catch(() => null);
                }

                // Canonical key so order doesn't matter
                const pairKey = [p1Id, p2Id].sort().join('_');
                const opponentId = clickerId === p1Id ? p2Id : p1Id;

                // ── COOLDOWN CHECK (FIX: Check before rematch)
                const now = Date.now();
                const cd = cooldowns.get(clickerId) || 0;
                if (now < cd) {
                    return interaction.reply({
                        content: `⏳ Cooldown! Wait **${Math.ceil((cd - now) / 1000)}s** before starting a new battle.`,
                        ephemeral: true
                    }).catch(() => null);
                }

                if (rematchPending.has(pairKey)) {
                    const pending = rematchPending.get(pairKey);

                    if (pending.initiatorId === clickerId) {
                        // Same person clicking again
                        return interaction.reply({
                            content: `⏳ Already waiting for <@${opponentId}> to confirm the rematch!`,
                            ephemeral: true
                        }).catch(() => null);
                    }

                    // OTHER player confirmed → start game!
                    clearTimeout(pending.timer);
                    rematchPending.delete(pairKey);

                    if (activeUsers.has(p1Id) || activeUsers.has(p2Id)) {
                        return interaction.reply({ content: '⚔️ A player is already in another game!', ephemeral: true }).catch(() => null);
                    }

                    await interaction.deferUpdate().catch(() => null);
                    const opponent = await client.users.fetch(opponentId).catch(() => null);
                    if (!opponent) return;

                    // Set cooldown for BOTH players on start
                    const newCd = Date.now() + COOLDOWN_MS;
                    cooldowns.set(p1Id, newCd);
                    cooldowns.set(p2Id, newCd);

                    return startNewGame(interaction, opponent);

                } else {
                    // First player requesting rematch
                    const timer = setTimeout(() => {
                        rematchPending.delete(pairKey);
                    }, 60_000);

                    rematchPending.set(pairKey, { initiatorId: clickerId, timer });

                    return interaction.reply({
                        content: `🎮 <@${clickerId}> wants a rematch! <@${opponentId}> — click **Rematch** to confirm! *(expires in 60s)*`,
                        ephemeral: false
                    }).catch(() => null);
                }
            }

            // GAME MOVE button
            const parts = interaction.customId.split('_');
            if (parts.length !== 3) return; // Malformed — ignore silently

            const [gameId, rawRow, rawCol] = parts;

            // Validate row/col are legit grid positions (FIX #6 — NaN crash)
            const r = parseInt(rawRow, 10);
            const c = parseInt(rawCol, 10);
            if (isNaN(r) || isNaN(c) || r < 0 || r > 2 || c < 0 || c > 2) return;

            const gameState = games.get(gameId);
            if (!gameState) {
                return interaction.reply({ content: '🏟️ This game has expired.', ephemeral: true }).catch(() => null);
            }

            // Turn check
            const currentPlayer = gameState.players[gameState.turn];
            if (!currentPlayer || interaction.user.id !== currentPlayer.id) {
                return interaction.reply({
                    content: `🚫 **Not your turn!** Waiting for <@${currentPlayer?.id}>.`,
                    ephemeral: true
                }).catch(() => null);
            }

            // ATOMIC LOCK (FIX #1 — race condition)
            if (lockSet.has(gameId)) {
                return interaction.deferUpdate().catch(() => null);
            }
            lockSet.add(gameId);

            // Acknowledge immediately
            await interaction.deferUpdate().catch(() => null);

            try {
                // Double check cell not already filled
                if (gameState.board[r][c]) return;

                // Clear AFK timers
                clearTimeout(gameState.afkWarningTimer);
                clearTimeout(gameState.afkForfeitTimer);

                // Make the move
                gameState.board[r][c] = gameState.turn;
                gameState.moveCount++;

                const winnerKey = checkWinner(gameState.board);
                let resX, resO;

                if (winnerKey) {
                    gameState.winner = gameState.players[winnerKey];
                    const loserKey = winnerKey === 'X' ? 'O' : 'X';
                    [resX, resO] = await Promise.all([
                        db.updateStats(gameState.players[winnerKey].id, 'win'),
                        db.updateStats(gameState.players[loserKey].id, 'loss')
                    ]);
                } else if (isBoardFull(gameState.board)) {
                    gameState.isDraw = true;
                    [resX, resO] = await Promise.all([
                        db.updateStats(gameState.players.X.id, 'draw'),
                        db.updateStats(gameState.players.O.id, 'draw')
                    ]);
                } else {
                    gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
                }

                // Render the board
                const strongest = await getStrongestCached(); // FIX #3 — cached!
                const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
                const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
                const embed = UI.createGameStatusEmbed(
                    gameState.players.X, gameState.players.O,
                    gameState.players[gameState.turn],
                    gameState.winner, gameState.isDraw
                );

                await interaction.editReply({
                    content: null, embeds: [embed], files: [attachment],
                    components: UI.createGameButtons(gameState.board, !!(gameState.winner || gameState.isDraw), gameId)
                });

                // ── GAME OVER ─────────────────────────────────────────────────
                if (gameState.winner || gameState.isDraw) {
                    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
                    const matchStats = { moves: gameState.moveCount, duration };
                    const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);

                    if (gameState.winner) {
                        const winnerRes = winnerKey === 'X' ? resX : resO;
                        const winEmbed = UI.createVictoryAnnouncement(
                            gameState.winner,
                            winnerRes?.data?.current_streak || 1,
                            winnerRes?.data?.points || 0,
                            matchStats
                        );
                        await interaction.followUp({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);

                        if (winnerRes?.rankUp) {
                            await interaction.followUp({
                                embeds: [UI.createRankUpAnnouncement(gameState.winner, winnerRes.oldRank, winnerRes.newRank)]
                            }).catch(() => null);
                        }
                        if (winnerRes?.milestoneStreak) {
                            await interaction.followUp({
                                embeds: [UI.createStreakMilestoneAnnouncement(gameState.winner, winnerRes.milestoneStreak)]
                            }).catch(() => null);
                        }
                    } else {
                        const drawEmbed = UI.createDrawAnnouncement(gameState.players.X, gameState.players.O);
                        await interaction.followUp({ embeds: [drawEmbed], components: [replayRow] }).catch(() => null);
                    }

                    cleanupGame(gameId); // FIX #7 — proper full cleanup

                } else {
                    // ── SET AFK TIMERS FOR NEXT PLAYER ────────────────────────
                    const nextPlayer = gameState.players[gameState.turn];

                    gameState.afkWarningTimer = setTimeout(async () => {
                        if (!games.has(gameId)) return;
                        await interaction.followUp({
                            embeds: [UI.createAfkWarning(nextPlayer, 15)]
                        }).catch(() => null);
                    }, AFK_WARNING_MS);

                    gameState.afkForfeitTimer = setTimeout(async () => {
                        if (!games.has(gameId)) return;
                        const gs = games.get(gameId);
                        const forfeitWinner = gs.players[gs.turn === 'X' ? 'O' : 'X'];
                        await Promise.all([
                            db.updateStats(forfeitWinner.id, 'win'),
                            db.updateStats(nextPlayer.id, 'loss')
                        ]).catch(() => null);
                        const replayRow = UI.createReplayButton(gs.players.X.id, gs.players.O.id);
                        await interaction.followUp({
                            embeds: [UI.createAfkForfeit(nextPlayer, forfeitWinner)],
                            components: [replayRow]
                        }).catch(() => null);
                        cleanupGame(gameId);
                    }, AFK_FORFEIT_MS);
                }

            } catch (err) {
                console.error('[Move Error]', err.message);
            } finally {
                // FIX #4 — ALWAYS release the lock, even if something threw
                lockSet.delete(gameId);
            }
        }

    } catch (err) {
        console.error('🛑 GLOBAL SHIELD:', err.message);
    }
});

// ─── START NEW GAME ───────────────────────────────────────────────────────────
async function startNewGame(interaction, opponent) {
    try {
        const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
        await interaction[method]({
            content: '🛡️ **Battle Loading...**', embeds: [], components: [], files: []
        }).catch(() => null);

        const gameId = interaction.id;
        const playerX = interaction.user || interaction.member?.user;
        const playerO = opponent;

        const gameState = {
            id: gameId,
            players: { X: playerX, O: playerO },
            board: Array(3).fill(null).map(() => Array(3).fill(null)),
            turn: 'X', winner: null, isDraw: false,
            startTime: Date.now(), moveCount: 0,
            afkWarningTimer: null, afkForfeitTimer: null, masterTimer: null
        };

        games.set(gameId, gameState);
        activeUsers.add(playerX.id); // FIX #5 — track active users
        activeUsers.add(playerO.id);

        const strongest = await getStrongestCached();
        const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
        const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
        const embed = UI.createGameStatusEmbed(playerX, playerO, playerX);

        await interaction.editReply({
            content: null, embeds: [embed], files: [attachment],
            components: UI.createGameButtons(gameState.board, false, gameId)
        });

        // Initial AFK timers (for player X who goes first)
        gameState.afkWarningTimer = setTimeout(async () => {
            if (!games.has(gameId)) return;
            await interaction.followUp({ embeds: [UI.createAfkWarning(playerX, 15)] }).catch(() => null);
        }, AFK_WARNING_MS);

        gameState.afkForfeitTimer = setTimeout(async () => {
            if (!games.has(gameId)) return;
            await Promise.all([
                db.updateStats(playerO.id, 'win'),
                db.updateStats(playerX.id, 'loss')
            ]).catch(() => null);
            const replayRow = UI.createReplayButton(playerX.id, playerO.id);
            await interaction.followUp({
                embeds: [UI.createAfkForfeit(playerX, playerO)],
                components: [replayRow]
            }).catch(() => null);
            cleanupGame(gameId);
        }, AFK_FORFEIT_MS);

        // FIX #7 — Master TTL clears AFK timers too before deleting
        gameState.masterTimer = setTimeout(() => cleanupGame(gameId), GAME_TTL_MS);

    } catch (e) {
        console.error('[Start Error]', e.message);
    }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function checkWinner(board) {
    for (let i = 0; i < 3; i++) {
        if (board[i][0] && board[i][0] === board[i][1] && board[i][0] === board[i][2]) return board[i][0];
        if (board[0][i] && board[0][i] === board[1][i] && board[0][i] === board[2][i]) return board[0][i];
    }
    if (board[0][0] && board[0][0] === board[1][1] && board[0][0] === board[2][2]) return board[0][0];
    if (board[0][2] && board[0][2] === board[1][1] && board[0][2] === board[2][0]) return board[0][2];
    return null;
}

function isBoardFull(board) {
    return board.every(row => row.every(cell => cell !== null));
}

client.login(process.env.TOKEN);
