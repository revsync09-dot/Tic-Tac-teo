require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const GameEngine = require('./components/GameEngine');
const UIBuilder = require('./components/UIBuilder');
const db = require('./db');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers],
    failIfNotExists: false
});

client.on('error', e => console.error('🛡️ SHIELD:', e));
process.on('unhandledRejection', e => console.error('🛡️ REJECTION:', e));

const games = new Map();
const cooldowns = new Map();
const GUILD_ID = process.env.GUILD_ID;

const EMOJIS = {
    X:       process.env.EMOJI_X       || '❌',
    O:       process.env.EMOJI_O       || '⭕',
    WIN:     process.env.EMOJI_WIN     || '🏆',
    RANK:    process.env.EMOJI_RANK    || '🏅',
    POINTS:  process.env.EMOJI_POINTS  || '💰',
    STREAK:  process.env.EMOJI_STREAK  || '🔥',
    REMATCH: process.env.EMOJI_REMATCH || '🎮',
    DRAW:    process.env.EMOJI_DRAW    || '🤝',
    CROWN:   process.env.EMOJI_CROWN   || '👑',
    SUCCESS: process.env.EMOJI_SUCCESS || '✅',
    ERROR:   process.env.EMOJI_ERROR   || '❌',
    EMPTY:   process.env.EMOJI_EMPTY   || '➖'
};

const UI = new UIBuilder(EMOJIS, client);

// ─── AFK TIMEOUT CONSTANTS ──────────────────────────────────────────────────
const AFK_WARNING_MS = 45_000;  // warn at 45s
const AFK_FORFEIT_MS = 60_000;  // forfeit at 60s

client.once('ready', async () => {
    console.log(`🚀 TIC TAC TEO V2.1 ACTIVE AS ${client.user.tag}!`);
    if (GUILD_ID) {
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            await guild.emojis.fetch();
            console.log(`✅ SYNCED: ${guild.name} (${guild.emojis.cache.size} emojis)`);
        } catch (e) { console.error('❌ SYNC FAIL:', e.message); }
    }
    console.log('📦 PRE-CACHING...');
    await Promise.all([EMOJIS.X, EMOJIS.O, EMOJIS.CROWN, EMOJIS.SUCCESS, EMOJIS.ERROR].map(e => GameEngine.getEmojiImage(e)));
    console.log('💎 ASSETS READY!');
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            // ── /tictactoe ───────────────────────────────────────────────────
            if (commandName === 'tictactoe') {
                const now = Date.now();
                const cd = cooldowns.get(interaction.user.id) || 0;
                if (now < cd) {
                    return interaction.reply({ content: `⏳ Cooldown! Wait ${Math.ceil((cd - now) / 1000)}s.`, ephemeral: true }).catch(() => null);
                }
                cooldowns.set(interaction.user.id, now + 5000);
                await startNewGame(interaction, interaction.options.getUser('opponent'));
            }

            // ── /leaderboard ─────────────────────────────────────────────────
            if (commandName === 'leaderboard') {
                await interaction.reply({ content: '🏆 Loading Hall of Legends...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest, total, userRank] = await Promise.all([
                        db.getLeaderboard(), db.getStrongestPlayer(),
                        db.getTotalGames(), db.getUserRank(interaction.user.id)
                    ]);
                    const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                    const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id);
                    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard_v2.png' });
                    const embed = UI.createLeaderboardEmbed(total, userRank);
                    if (strongest) embed.addFields({ name: '👑 Strongest Warrior', value: `<@${strongest.user_id}> — Streak: **${strongest.highest_streak}**` });
                    await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
                } catch (err) {
                    console.error('LB Error:', err);
                    await interaction.editReply({ content: '❌ Could not load leaderboard.' });
                }
            }

            // ── /profile ─────────────────────────────────────────────────────
            if (commandName === 'profile') {
                await interaction.reply({ content: '📊 Loading your profile...', ephemeral: false }).catch(() => null);
                try {
                    const target = interaction.options.getUser('user') || interaction.user;
                    const [stats, globalRank] = await Promise.all([
                        db.getUserStats(target.id),
                        db.getUserRank(target.id)
                    ]);

                    if (!stats) {
                        return interaction.editReply({ content: `<@${target.id}> hasn't played any games yet! Use \`/tictactoe\` to get started.` });
                    }

                    const rank = db.getRankTitle(stats.points);
                    const buffer = await GameEngine.renderProfileCard(target, stats, rank, globalRank);
                    const attachment = new AttachmentBuilder(buffer, { name: 'profile_v2.png' });

                    const embed = new (require('discord.js').EmbedBuilder)()
                        .setColor(UI.getRank(stats.points).color)
                        .setTitle(`${target.username}'s Arena Profile`)
                        .setImage('attachment://profile_v2.png')
                        .setFooter({ text: 'Hyperions Arena • v2.1' });

                    await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
                } catch (err) {
                    console.error('Profile Error:', err);
                    await interaction.editReply({ content: '❌ Could not load profile.' });
                }
            }
        }

        if (interaction.isButton()) {
            // ── REPLAY ───────────────────────────────────────────────────────
            if (interaction.customId.startsWith('replay_')) {
                const [_, p1Id, p2Id] = interaction.customId.split('_');
                if (interaction.user.id !== p1Id && interaction.user.id !== p2Id) {
                    return interaction.reply({ content: "Only original warriors can rematch!", ephemeral: true }).catch(() => null);
                }
                await interaction.deferUpdate().catch(() => null);
                const opponent = await client.users.fetch(interaction.user.id === p1Id ? p2Id : p1Id);
                return startNewGame(interaction, opponent);
            }

            // ── GAME MOVE ────────────────────────────────────────────────────
            const [gameId, row, col] = interaction.customId.split('_');
            const gameState = games.get(gameId);
            if (!gameState) return interaction.reply({ content: "🏟️ Game expired.", ephemeral: true }).catch(() => null);

            const currentPlayer = gameState.players[gameState.turn];
            if (interaction.user.id !== currentPlayer.id) {
                return interaction.reply({ content: `🚫 **Wait your turn!** <@${currentPlayer.id}> is thinking.`, ephemeral: true }).catch(() => null);
            }
            if (gameState.processing) return interaction.deferUpdate().catch(() => null);

            // Reset AFK timer on valid move
            clearTimeout(gameState.afkWarningTimer);
            clearTimeout(gameState.afkForfeitTimer);

            gameState.processing = true;
            await interaction.deferUpdate().catch(() => null);

            const r = parseInt(row), c = parseInt(col);
            if (gameState.board[r][c]) { gameState.processing = false; return; }

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

            try {
                const strongest = await db.getStrongestPlayer();
                const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
                const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
                const embed = UI.createGameStatusEmbed(gameState.players.X, gameState.players.O, gameState.players[gameState.turn], gameState.winner, gameState.isDraw);

                await interaction.editReply({
                    content: null, embeds: [embed], files: [attachment],
                    components: UI.createGameButtons(gameState.board, !!(gameState.winner || gameState.isDraw), gameId)
                });

                const winnerResult = winnerKey ? (winnerKey === 'X' ? resX : resO) : null;

                if (gameState.winner || gameState.isDraw) {
                    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
                    const stats = { moves: gameState.moveCount, duration };
                    const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);

                    if (gameState.winner) {
                        const wr = winnerResult;
                        const winEmbed = UI.createVictoryAnnouncement(gameState.winner, wr?.data?.current_streak || 1, wr?.data?.points || 0, stats);
                        await interaction.followUp({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);

                        // RANK UP announcement
                        if (wr?.rankUp) {
                            const rankEmbed = UI.createRankUpAnnouncement(gameState.winner, wr.oldRank, wr.newRank);
                            await interaction.followUp({ embeds: [rankEmbed] }).catch(() => null);
                        }

                        // STREAK MILESTONE announcement
                        if (wr?.milestoneStreak) {
                            const streakEmbed = UI.createStreakMilestoneAnnouncement(gameState.winner, wr.milestoneStreak);
                            await interaction.followUp({ embeds: [streakEmbed] }).catch(() => null);
                        }
                    } else {
                        const drawEmbed = UI.createDrawAnnouncement(gameState.players.X, gameState.players.O);
                        await interaction.followUp({ embeds: [drawEmbed], components: [replayRow] }).catch(() => null);
                    }
                } else {
                    // AFK Timers for the next player
                    const nextPlayer = gameState.players[gameState.turn];
                    gameState.afkWarningTimer = setTimeout(async () => {
                        try {
                            const warnEmbed = UI.createAfkWarning(nextPlayer, 15);
                            await interaction.followUp({ embeds: [warnEmbed] }).catch(() => null);
                        } catch { /* ignore */ }
                    }, AFK_WARNING_MS);

                    gameState.afkForfeitTimer = setTimeout(async () => {
                        if (!games.has(gameId)) return;
                        const gs = games.get(gameId);
                        const forfeitWinner = gs.players[gs.turn === 'X' ? 'O' : 'X'];
                        await Promise.all([
                            db.updateStats(forfeitWinner.id, 'win'),
                            db.updateStats(nextPlayer.id, 'loss')
                        ]);
                        const forfeitEmbed = UI.createAfkForfeit(nextPlayer, forfeitWinner);
                        const replayRow = UI.createReplayButton(gs.players.X.id, gs.players.O.id);
                        await interaction.followUp({ embeds: [forfeitEmbed], components: [replayRow] }).catch(() => null);
                        games.delete(gameId);
                    }, AFK_FORFEIT_MS);
                }
            } catch (err) {
                console.error('Move Render Error:', err);
            }

            gameState.processing = false;
            if (gameState.winner || gameState.isDraw) games.delete(gameId);
        }
    } catch (err) {
        console.error('🛑 CRITICAL:', err);
    }
});

async function startNewGame(interaction, opponent) {
    try {
        if (!opponent || opponent.bot || opponent.id === (interaction.user?.id || interaction.member?.id)) {
            return interaction.reply({ content: "Invalid challenge!", ephemeral: true }).catch(() => null);
        }
        const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
        await interaction[method]({ content: '🛡️ **Battle Loading...**', embeds: [], components: [], files: [] }).catch(() => null);

        const gameId = interaction.id;
        const gameState = {
            id: gameId,
            players: { X: interaction.user || interaction.member.user, O: opponent },
            board: Array(3).fill(null).map(() => Array(3).fill(null)),
            turn: 'X', winner: null, isDraw: false, processing: false,
            startTime: Date.now(), moveCount: 0,
            afkWarningTimer: null, afkForfeitTimer: null
        };
        games.set(gameId, gameState);

        const strongest = await db.getStrongestPlayer();
        const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
        const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
        const embed = UI.createGameStatusEmbed(gameState.players.X, opponent, gameState.players.X);

        await interaction.editReply({
            content: null, embeds: [embed], files: [attachment],
            components: UI.createGameButtons(gameState.board, false, gameId)
        });

        // Set initial AFK timer for X
        gameState.afkWarningTimer = setTimeout(async () => {
            if (!games.has(gameId)) return;
            const warnEmbed = UI.createAfkWarning(gameState.players.X, 15);
            await interaction.followUp({ embeds: [warnEmbed] }).catch(() => null);
        }, AFK_WARNING_MS);

        gameState.afkForfeitTimer = setTimeout(async () => {
            if (!games.has(gameId)) return;
            const gs = games.get(gameId);
            await Promise.all([
                db.updateStats(gs.players.O.id, 'win'),
                db.updateStats(gs.players.X.id, 'loss')
            ]);
            const forfeitEmbed = UI.createAfkForfeit(gs.players.X, gs.players.O);
            const replayRow = UI.createReplayButton(gs.players.X.id, gs.players.O.id);
            await interaction.followUp({ embeds: [forfeitEmbed], components: [replayRow] }).catch(() => null);
            games.delete(gameId);
        }, AFK_FORFEIT_MS);

        setTimeout(() => { clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer); games.delete(gameId); }, 300_000);
    } catch (e) {
        console.error('Start Error:', e);
    }
}

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
