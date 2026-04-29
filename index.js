require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const GameEngine = require('./components/GameEngine');
const UIBuilder = require('./components/UIBuilder');

// ─── INIT ────────────────────────────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const games           = new Map();   // gameId → gameState
const cooldowns       = new Map();   // userId → expirationTimestamp
const activeUsers     = new Set();   // userIds in a game
const lockSet         = new Set();   // atomic move locks
const challengeLocks  = new Set();   // prevents double-acceptance
const rematchPending  = new Map(); // pairKey → { initiatorId, timer }
const challengesPending = new Map(); // targetId → { challengerId, timer }

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GUILD_ID        = process.env.GUILD_ID;
const GAME_CHANNEL_ID = '1498406160204828742'; 
const BYPASS_ROLE_ID   = '795466540140986368';
const AFK_WARNING_MS   = 45_000;
const AFK_FORFEIT_MS   = 60_000;
const COOLDOWN_MS      = 20_000; 
const GAME_TTL_MS      = 300_000;

const EMOJIS = {
    // Core Game
    X:       process.env.EMOJI_X       || '❌',
    O:       process.env.EMOJI_O       || '⭕',
    EMPTY:   process.env.EMOJI_EMPTY   || '➖',

    // Ranks & Stats
    WIN:     process.env.EMOJI_WIN     || '🏆',
    RANK:    process.env.EMOJI_RANK    || '🏅',
    POINTS:  process.env.EMOJI_POINTS  || '💰',
    STREAK:  process.env.EMOJI_STREAK  || '🔥',
    STATS:   process.env.EMOJI_STATS   || '1480578098952142999',
    CROWN:   process.env.EMOJI_CROWN   || process.env.EMOJI_WIN || '1482120473251807302',

    // Game Actions
    REMATCH: process.env.EMOJI_REMATCH || '🎮',
    DRAW:    process.env.EMOJI_DRAW    || '🤝',
    
    // Connect 4
    C4_RED:    process.env.EMOJI_C4_RED    || '🔴',
    C4_YELLOW: process.env.EMOJI_C4_YELLOW || '🟡',
    C4_EMPTY:  process.env.EMOJI_C4_EMPTY  || '⚫',

    // RPS
    RPS_ROCK:     process.env.EMOJI_RPS_ROCK     || '🪨',
    RPS_PAPER:    process.env.EMOJI_RPS_PAPER    || '📄',
    RPS_SCISSORS: process.env.EMOJI_RPS_SCISSORS || '✂️',
    RPS_HIDDEN:   process.env.EMOJI_RPS_HIDDEN   || '❓',
    RPS_READY:    process.env.EMOJI_RPS_READY    || '✅',

    // UI Custom Embed Format
    UI_TITLE: process.env.EMOJI_UI_TITLE || '⚔️',
    UI_GAME:  process.env.EMOJI_UI_GAME  || '🎮',
    UI_INFO:  process.env.EMOJI_UI_INFO  || '❗',
    UI_GEAR:  process.env.EMOJI_UI_GEAR  || '⚙️',

    // System & General Messages
    SYS_ERROR:    process.env.EMOJI_SYS_ERROR    || '❌',
    SYS_WARNING:  process.env.EMOJI_SYS_WARNING  || '⚠️',
    SYS_SUCCESS:  process.env.EMOJI_SYS_SUCCESS  || '✅',
    SYS_COOLDOWN: process.env.EMOJI_SYS_COOLDOWN || '⏳',
    SYS_DENIED:   process.env.EMOJI_SYS_DENIED   || '🚫',
    
    // Events
    EVENT_EXPIRED:   process.env.EMOJI_EVENT_EXPIRED   || '🏟️',

    // Rewards & Leaderboard
    MEDAL_1:    process.env.EMOJI_MEDAL_1    || '🥇',
    MEDAL_2:    process.env.EMOJI_MEDAL_2    || '🥈',
    MEDAL_3:    process.env.EMOJI_MEDAL_3    || '🥉',
    CALENDAR:   process.env.EMOJI_CALENDAR   || '📅',
    RANK_UP:    process.env.EMOJI_RANK_UP    || '⭐',
    PARTY:      process.env.EMOJI_PARTY      || '🎉',
    ROCKET:     process.env.EMOJI_ROCKET     || '🚀',
    AFK_STOP:   process.env.EMOJI_AFK_STOP   || '🛑'
};

const UI = new UIBuilder(EMOJIS, client);

// ─── EVENTS ──────────────────────────────────────────────────────────────────
client.once('ready', () => {
    console.log(`🚀 TIC TAC TEO V2.1 [NOKIA-STONE HARDENED] ACTIVE!`);
    // Cleanup stale cooldowns every minute
    setInterval(() => {
        const now = Date.now();
        for (const [id, exp] of cooldowns) if (now >= exp) cooldowns.delete(id);
    }, 60_000);
});

client.on('interactionCreate', async interaction => {
    try {
        // ── SLASH COMMANDS ───────────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const bypassUserId = '795466540140986368';
            const hasBypassRole = interaction.member && interaction.member.roles && interaction.member.roles.cache.has(BYPASS_ROLE_ID);
            if (interaction.channelId !== GAME_CHANNEL_ID && interaction.user.id !== bypassUserId && !hasBypassRole) {
                return interaction.reply({ content: `\${EMOJIS.SYS_DENIED} **Wrong Channel!** Use <#\${GAME_CHANNEL_ID}>.`, ephemeral: true }).catch(() => null);
            }

            const { commandName } = interaction;

            if (['tictactoe', 'connect4', 'rps'].includes(commandName)) {
                const now = Date.now();
                const cd = cooldowns.get(interaction.user.id) || 0;
                if (now < cd) return interaction.reply({ content: `\${EMOJIS.SYS_COOLDOWN} Cooldown! Wait **\${Math.ceil((cd - now) / 1000)}s**.`, ephemeral: true }).catch(() => null);

                const opponent = interaction.options.getUser('opponent');
                if (!opponent || opponent.bot || opponent.id === interaction.user.id) return interaction.reply({ content: `\${EMOJIS.SYS_ERROR} Invalid opponent.`, ephemeral: true }).catch(() => null);
                if (activeUsers.has(interaction.user.id)) return interaction.reply({ content: `\${EMOJIS.UI_TITLE} You are already in a game!`, ephemeral: true }).catch(() => null);
                if (activeUsers.has(opponent.id)) return interaction.reply({ content: `\${EMOJIS.UI_TITLE} Opponent is already in a game!`, ephemeral: true }).catch(() => null);

                cooldowns.set(interaction.user.id, now + COOLDOWN_MS);
                
                const gameNames = { tictactoe: 'Tic Tac Toe', connect4: 'Vier Gewinnt', rps: 'Schere-Stein-Papier' };
                const challengeEmbed = UI.createChallengeEmbed(interaction.user, opponent, gameNames[commandName]);
                const row = UI.createChallengeButtons(interaction.user.id, opponent.id, commandName);
                await interaction.reply({ content: `\${EMOJIS.UI_TITLE} <@\${opponent.id}>, you have been challenged!`, embeds: [challengeEmbed], components: [row] }).catch(() => null);

                const timer = setTimeout(() => {
                    if (challengesPending.has(opponent.id)) {
                        challengesPending.delete(opponent.id);
                        interaction.editReply({ content: null, embeds: [UI.createSystemEmbed('CHALLENGE EXPIRED', 'The request timed out.', true)], components: [] }).catch(() => null);
                    }
                }, 60_000);
                challengesPending.set(opponent.id, { challengerId: interaction.user.id, timer, type: commandName });
            }

            if (commandName === 'leaderboard') {
                await interaction.deferReply().catch(() => null);
                const [topPlayers, strongest] = await Promise.all([db.getLeaderboard(), db.getStrongestPlayer()]);
                const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id);
                const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard_v2.png' });
                await interaction.editReply({ content: null, files: [attachment] }).catch(() => null);
            }

            if (commandName === 'weekly') {
                await interaction.deferReply().catch(() => null);
                const [topPlayers, strongest] = await Promise.all([db.getWeeklyLeaderboard(), db.getStrongestPlayer()]);
                const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(Boolean), EMOJIS, strongest?.user_id, 'WEEKLY RANKINGS');
                const attachment = new AttachmentBuilder(buffer, { name: 'weekly_v2.png' });
                await interaction.editReply({ content: null, files: [attachment] }).catch(() => null);
            }

            if (commandName === 'profile') {
                const target = interaction.options.getUser('user') || interaction.user;
                await interaction.deferReply().catch(() => null);
                const [stats, globalRank] = await Promise.all([db.getUserStats(target.id), db.getUserRank(target.id)]);
                if (!stats) return interaction.editReply({ content: 'No stats yet!' }).catch(() => null);
                const rank = db.getRankTitle(stats.points);
                const buffer = await GameEngine.renderProfileCard(target, stats, rank, globalRank);
                const attachment = new AttachmentBuilder(buffer, { name: 'profile_v2.png' });
                const embed = new EmbedBuilder().setColor(UI.getRank(stats.points).color).setTitle(`\${target.username}'s Arena Profile`).setImage('attachment://profile_v2.png');
                await interaction.editReply({ content: null, embeds: [embed], files: [attachment] }).catch(() => null);
            }

            if (commandName === 'rewards') {
                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setDescription(
                        `${UI.formatEmoji(EMOJIS.POINTS, '💰')} **\` REWARDS SYSTEM \`**\n\n` +
                        `┃ 🥇 **\` Weekly Champion \`**\n` +
                        `┃ ❗ **\` 10,000 Points \`**\n\n` +
                        `┃ 🥈 **\` Runner Up \`**\n` +
                        `┃ ❗ **\` 5,000 Points \`**\n\n` +
                        `┃ 🥉 **\` Third Place \`**\n` +
                        `┃ ❗ **\` 2,500 Points \`**\n\n` +
                        `\`\`\`diff\n` +
                        `+ Reset: Every Monday 00:00 UTC\n` +
                        `\`\`\`\n`
                    );
                return interaction.reply({ embeds: [embed] }).catch(() => null);
            }
        }

        // ── BUTTONS ───────────────────────────────────────────────────────────
        if (interaction.isButton()) {
            
            // ACCEPT BATTLE button
            if (interaction.customId.startsWith('accept_')) {
                const parts = interaction.customId.split('_');
                const gameType = parts[1], challengerId = parts[2], targetId = parts[3];
                if (interaction.user.id !== targetId) return interaction.reply({ content: `\${EMOJIS.SYS_ERROR} This is not your challenge!`, ephemeral: true }).catch(() => null);
                
                // Prevent spam clicks
                if (challengeLocks.has(targetId)) return;
                challengeLocks.add(targetId);

                const pending = challengesPending.get(targetId);
                if (!pending || pending.challengerId !== challengerId || pending.type !== gameType) {
                    challengeLocks.delete(targetId);
                    return interaction.reply({ content: `\${EMOJIS.SYS_COOLDOWN} Challenge expired or invalid.`, ephemeral: true }).catch(() => null);
                }

                if (activeUsers.has(challengerId) || activeUsers.has(targetId)) {
                    challengeLocks.delete(targetId);
                    return interaction.reply({ content: `\${EMOJIS.UI_TITLE} One of you is already in a game!`, ephemeral: true }).catch(() => null);
                }

                clearTimeout(pending.timer);
                challengesPending.delete(targetId);
                
                await interaction.deferUpdate().catch(() => null);
                const challenger = await client.users.fetch(challengerId).catch(() => null);
                
                // Set cooldown for BOTH
                const newCd = Date.now() + COOLDOWN_MS;
                cooldowns.set(challengerId, newCd); cooldowns.set(targetId, newCd);
                
                try {
                    await startNewGame(interaction, challenger, gameType);
                } finally {
                    challengeLocks.delete(targetId);
                }
                return;
            }

            // REMATCH button
            if (interaction.customId.startsWith('replay_')) {
                const parts = interaction.customId.split('_');
                const p1Id = parts[1], p2Id = parts[2];
                const clickerId = interaction.user.id;
                if (clickerId !== p1Id && clickerId !== p2Id) return interaction.reply({ content: `\${EMOJIS.SYS_ERROR} Not your game!`, ephemeral: true }).catch(() => null);

                const pairKey = [p1Id, p2Id].sort().join('_');
                const opponentId = clickerId === p1Id ? p2Id : p1Id;
                const cd = cooldowns.get(clickerId) || 0;
                if (Date.now() < cd) return interaction.reply({ content: `\${EMOJIS.SYS_COOLDOWN} Cooldown! Wait **\${Math.ceil((cd - Date.now()) / 1000)}s**.`, ephemeral: true }).catch(() => null);

                if (rematchPending.has(pairKey)) {
                    const pending = rematchPending.get(pairKey);
                    if (pending.initiatorId === clickerId) return interaction.reply({ content: `\${EMOJIS.SYS_COOLDOWN} Waiting for opponent...`, ephemeral: true }).catch(() => null);
                    
                    clearTimeout(pending.timer); rematchPending.delete(pairKey);
                    if (activeUsers.has(p1Id) || activeUsers.has(p2Id)) return interaction.reply({ content: `\${EMOJIS.UI_TITLE} Someone is in another game!`, ephemeral: true }).catch(() => null);
                    
                    await interaction.deferUpdate().catch(() => null);
                    const opponent = await client.users.fetch(opponentId).catch(() => null);
                    return startNewGame(interaction, opponent, pending.gameType || 'tictactoe');
                } else {
                    const lastGameType = activeUsers.get(pairKey) || 'tictactoe'; // Fallback
                    const timer = setTimeout(() => { rematchPending.delete(pairKey); }, 60_000);
                    rematchPending.set(pairKey, { initiatorId: clickerId, timer, gameType: interaction.message.embeds[0]?.title?.includes('Schere') ? 'rps' : (interaction.message.embeds[0]?.title?.includes('Vier') ? 'connect4' : 'tictactoe') });
                    return interaction.reply({ content: `\${EMOJIS.UI_GAME} <@\${clickerId}> wants a rematch! <@\${opponentId}> — click **Rematch**!`, ephemeral: false }).catch(() => null);
                }
            }

            // GAME MOVES
            const customId = interaction.customId;
            let gameId, action, extraAction;
            
            if (customId.startsWith('c4_')) {
                [, gameId, action] = customId.split('_');
            } else if (customId.startsWith('rps_')) {
                [, gameId, action] = customId.split('_');
            } else {
                const parts = customId.split('_');
                if (parts.length === 3) [gameId, action, extraAction] = parts;
                else return;
            }

            const gameState = games.get(gameId);
            if (!gameState) return interaction.reply({ content: `\${EMOJIS.EVENT_EXPIRED} Game expired.`, ephemeral: true }).catch(() => null);

            // Atomic Lock
            if (lockSet.has(gameId)) return;
            lockSet.add(gameId);

            try {
                if (gameState.type === 'tictactoe') {
                    await handleTTTMove(interaction, gameState, action, extraAction);
                } else if (gameState.type === 'connect4') {
                    await handleC4Move(interaction, gameState, action);
                } else if (gameState.type === 'rps') {
                    await handleRPSMove(interaction, gameState, action);
                }
            } finally { lockSet.delete(gameId); }
        }
    } catch (e) { console.error('[Fatal Interaction Error]', e); }
});

async function handleTTTMove(interaction, gameState, row, col) {
    const currentPlayer = gameState.players[gameState.turn];
    if (interaction.user.id !== currentPlayer.id) return interaction.reply({ content: `\${EMOJIS.SYS_DENIED} **Not your turn!**`, ephemeral: true }).catch(() => null);
    
    await interaction.deferUpdate().catch(() => null);
    const r = parseInt(row), c = parseInt(col);
    if (gameState.board[r][c]) return;

    clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer);
    gameState.board[r][c] = gameState.turn;
    gameState.moveCount++;

    const winnerKey = checkWinnerTTT(gameState.board);
    let resX, resO;

    if (winnerKey) {
        gameState.winner = gameState.players[winnerKey];
        const loserKey = winnerKey === 'X' ? 'O' : 'X';
        [resX, resO] = await Promise.all([db.updateStats(gameState.players[winnerKey].id, 'win'), db.updateStats(gameState.players[loserKey].id, 'loss')]).catch(() => [null, null]);
    } else if (isBoardFullTTT(gameState.board)) {
        gameState.isDraw = true;
        [resX, resO] = await Promise.all([db.updateStats(gameState.players.X.id, 'draw'), db.updateStats(gameState.players.O.id, 'draw')]).catch(() => [null, null]);
    } else {
        gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
    }

    const strongest = await db.getStrongestPlayer().catch(() => null);
    const buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
    const attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
    const embed = UI.createGameStatusEmbed(gameState.players.X, gameState.players.O, gameState.players[gameState.turn], gameState.winner, gameState.isDraw, 'Tic Tac Toe');

    await interaction.editReply({
        content: null, embeds: [embed], files: [attachment],
        components: UI.createGameComponents(gameState.board, !!(gameState.winner || gameState.isDraw), gameState.id)
    }).catch(() => null);

    await finishGame(interaction, gameState, winnerKey, resX, resO);
}

async function handleC4Move(interaction, gameState, colStr) {
    const currentPlayer = gameState.players[gameState.turn];
    if (interaction.user.id !== currentPlayer.id) return interaction.reply({ content: `\${EMOJIS.SYS_DENIED} **Not your turn!**`, ephemeral: true }).catch(() => null);
    
    await interaction.deferUpdate().catch(() => null);
    const col = parseInt(colStr);
    
    let placedRow = -1;
    for (let r = 5; r >= 0; r--) {
        if (!gameState.board[r][col]) {
            gameState.board[r][col] = gameState.turn;
            placedRow = r;
            break;
        }
    }
    if (placedRow === -1) return; 

    clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer);
    gameState.moveCount++;

    const winnerKey = checkWinnerC4(gameState.board);
    let resX, resO;

    if (winnerKey) {
        gameState.winner = gameState.players[winnerKey];
        const loserKey = winnerKey === 'X' ? 'O' : 'X';
        [resX, resO] = await Promise.all([db.updateStats(gameState.players[winnerKey].id, 'win'), db.updateStats(gameState.players[loserKey].id, 'loss')]).catch(() => [null, null]);
    } else if (isBoardFullC4(gameState.board)) {
        gameState.isDraw = true;
        [resX, resO] = await Promise.all([db.updateStats(gameState.players.X.id, 'draw'), db.updateStats(gameState.players.O.id, 'draw')]).catch(() => [null, null]);
    } else {
        gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
    }

    const strongest = await db.getStrongestPlayer().catch(() => null);
    const buffer = await GameEngine.renderC4Board(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
    const attachment = new AttachmentBuilder(buffer, { name: 'c4_board.png' });
    const embed = UI.createGameStatusEmbed(gameState.players.X, gameState.players.O, gameState.players[gameState.turn], gameState.winner, gameState.isDraw, 'Vier Gewinnt', 'c4_board.png');

    await interaction.editReply({
        content: null, embeds: [embed], files: [attachment],
        components: UI.createC4Components(gameState.board, !!(gameState.winner || gameState.isDraw), gameState.id)
    }).catch(() => null);

    await finishGame(interaction, gameState, winnerKey, resX, resO);
}

async function handleRPSMove(interaction, gameState, move) {
    const isPlayerX = interaction.user.id === gameState.players.X.id;
    const isPlayerO = interaction.user.id === gameState.players.O.id;
    if (!isPlayerX && !isPlayerO) return interaction.reply({ content: `\${EMOJIS.SYS_DENIED} **Not your game!**`, ephemeral: true }).catch(() => null);
    
    const pKey = isPlayerX ? 'X' : 'O';
    if (gameState.moves[pKey]) return interaction.reply({ content: `\${EMOJIS.SYS_SUCCESS} Du hast bereits **\${gameState.moves[pKey]}** gewählt. Warte auf den Gegner!`, ephemeral: true }).catch(() => null);

    gameState.moves[pKey] = move;
    await interaction.reply({ content: `\${EMOJIS.SYS_SUCCESS} Move locked: **\${move}**.`, ephemeral: true }).catch(() => null);

    if (gameState.moves.X && gameState.moves.O) {
        clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer);
        
        const winnerKey = evaluateRPSRound(gameState.moves.X, gameState.moves.O);
        let roundInfo = '';
        if (winnerKey === 'draw') {
            roundInfo = 'RUNDE UNENTSCHIEDEN!';
        } else {
            gameState.scores[winnerKey]++;
            roundInfo = `${gameState.players[winnerKey].username} gewinnt die Runde!`;
        }

        const matchWinnerKey = gameState.scores.X === 2 ? 'X' : (gameState.scores.O === 2 ? 'O' : null);
        let resX, resO;

        if (matchWinnerKey) {
            gameState.winner = gameState.players[matchWinnerKey];
            const loserKey = matchWinnerKey === 'X' ? 'O' : 'X';
            [resX, resO] = await Promise.all([db.updateStats(gameState.players[matchWinnerKey].id, 'win'), db.updateStats(gameState.players[loserKey].id, 'loss')]).catch(() => [null, null]);
        }

        const buffer = await GameEngine.renderRPS(gameState.moves, gameState.players, roundInfo, EMOJIS);
        const attachment = new AttachmentBuilder(buffer, { name: 'rps_v2.png' });
        const embed = UI.createRPSStatusEmbed(gameState.players.X, gameState.players.O, gameState.scores, gameState.round, gameState.winner);

        if (!matchWinnerKey) {
            gameState.moves = { X: null, O: null };
            gameState.round++;
        }

        await interaction.message.edit({
            content: null, embeds: [embed], files: [attachment],
            components: UI.createRPSComponents(gameState.id, !!matchWinnerKey)
        }).catch(() => null);

        if (matchWinnerKey) {
            await finishGame(interaction, gameState, matchWinnerKey, resX, resO);
        } else {
            setupAfkTimers(gameState);
        }
    }
}

async function finishGame(interaction, gameState, winnerKey, resX, resO) {
    if (!gameState.winner && !gameState.isDraw) {
        setupAfkTimers(gameState);
        return;
    }
    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
    const matchStats = { moves: gameState.moveCount || gameState.round, duration };
    const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);
    
    if (gameState.winner) {
        const winData = winnerKey === 'X' ? resX : resO;
        const winEmbed = UI.createVictoryAnnouncement(gameState.winner, winData?.data?.current_streak || 1, winData?.data?.points || 0, matchStats);
        if (gameState.type === 'rps') {
            await interaction.channel.send({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);
        } else {
            await interaction.followUp({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);
        }
    } else {
        if (gameState.type === 'rps') {
            await interaction.channel.send({ embeds: [UI.createDrawAnnouncement(gameState.players.X, gameState.players.O)], components: [replayRow] }).catch(() => null);
        } else {
            await interaction.followUp({ embeds: [UI.createDrawAnnouncement(gameState.players.X, gameState.players.O)], components: [replayRow] }).catch(() => null);
        }
    }
    cleanupGame(gameState.id);
}

async function startNewGame(interaction, opponent, type = 'tictactoe') {
    const gameId = interaction.id;
    const playerX = interaction.user;
    
    const gameState = {
        id: gameId, type, players: { X: playerX, O: opponent },
        turn: 'X', winner: null, isDraw: false, startTime: Date.now(), moveCount: 0
    };

    if (type === 'tictactoe') {
        gameState.board = Array(3).fill(null).map(() => Array(3).fill(null));
    } else if (type === 'connect4') {
        gameState.board = Array(6).fill(null).map(() => Array(7).fill(null));
    } else if (type === 'rps') {
        gameState.moves = { X: null, O: null };
        gameState.scores = { X: 0, O: 0 };
        gameState.round = 1;
        gameState.turn = null; 
    }

    games.set(gameId, gameState); activeUsers.add(playerX.id); activeUsers.add(opponent.id);
    
    try {
        let buffer, attachment, embed, components;
        const strongest = await db.getStrongestPlayer().catch(() => null);

        if (type === 'tictactoe') {
            buffer = await GameEngine.renderBoard(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
            attachment = new AttachmentBuilder(buffer, { name: 'board_v2.png' });
            embed = UI.createGameStatusEmbed(playerX, opponent, playerX, null, false, 'Tic Tac Toe', 'board_v2.png');
            components = UI.createGameComponents(gameState.board, false, gameId);
        } else if (type === 'connect4') {
            buffer = await GameEngine.renderC4Board(gameState.board, EMOJIS, gameState.players, strongest?.user_id);
            attachment = new AttachmentBuilder(buffer, { name: 'c4_board.png' });
            embed = UI.createGameStatusEmbed(playerX, opponent, playerX, null, false, 'Vier Gewinnt', 'c4_board.png');
            components = UI.createC4Components(gameState.board, false, gameId);
        } else if (type === 'rps') {
            buffer = await GameEngine.renderRPS(gameState.moves, gameState.players, 'Wähle deine Aktion!', EMOJIS);
            attachment = new AttachmentBuilder(buffer, { name: 'rps_v2.png' });
            embed = UI.createRPSStatusEmbed(playerX, opponent, gameState.scores, gameState.round);
            components = UI.createRPSComponents(gameId, false);
        }

        await interaction.editReply({ content: null, embeds: [embed], files: [attachment], components }).catch(() => null);
        setupAfkTimers(gameState);
    } catch (e) {
        console.error('[Start Error]', e);
        cleanupGame(gameId);
    }
}

function setupAfkTimers(gs) {
    clearTimeout(gs.afkWarningTimer); clearTimeout(gs.afkForfeitTimer);
    gs.afkWarningTimer = setTimeout(async () => {
        const chan = client.channels.cache.get(GAME_CHANNEL_ID);
        if (chan) {
            const warningTarget = gs.type === 'rps' 
                ? (!gs.moves.X ? gs.players.X.id : gs.players.O.id)
                : gs.players[gs.turn].id;
            chan.send({ embeds: [UI.createSystemEmbed('AFK WARNING', `<@${warningTarget}> you have 15 seconds to make your move! Fail to move and you will forfeit the game!`)] }).catch(() => null);
        }
    }, AFK_WARNING_MS);
    gs.afkForfeitTimer = setTimeout(async () => {
        const loserKey = gs.type === 'rps' 
            ? (!gs.moves.X ? 'X' : 'O')
            : gs.turn;
        const winnerKey = loserKey === 'X' ? 'O' : 'X';
        const winner = gs.players[winnerKey]; const loser = gs.players[loserKey];
        await db.updateStats(winner.id, 'win').catch(() => null); await db.updateStats(loser.id, 'loss').catch(() => null);
        const chan = client.channels.cache.get(GAME_CHANNEL_ID);
        if (chan) chan.send({ embeds: [UI.createAfkForfeit(loser, winner)], components: [UI.createReplayButton(gs.players.X.id, gs.players.O.id)] }).catch(() => null);
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

function checkWinnerTTT(board) {
    for (let i = 0; i < 3; i++) {
        if (board[i][0] && board[i][0] === board[i][1] && board[i][0] === board[i][2]) return board[i][0];
        if (board[0][i] && board[0][i] === board[1][i] && board[0][i] === board[2][i]) return board[0][i];
    }
    if (board[0][0] && board[0][0] === board[1][1] && board[0][0] === board[2][2]) return board[0][0];
    if (board[0][2] && board[0][2] === board[1][1] && board[0][2] === board[2][0]) return board[0][2];
    return null;
}

function isBoardFullTTT(board) { return board.every(row => row.every(cell => cell !== null)); }

function checkWinnerC4(board) {
    const rows = 6, cols = 7;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 3; c++) {
            if (board[r][c] && board[r][c] === board[r][c+1] && board[r][c] === board[r][c+2] && board[r][c] === board[r][c+3]) return board[r][c];
        }
    }
    for (let r = 0; r < rows - 3; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c] && board[r][c] === board[r+1][c] && board[r][c] === board[r+2][c] && board[r][c] === board[r+3][c]) return board[r][c];
        }
    }
    for (let r = 0; r < rows - 3; r++) {
        for (let c = 0; c < cols - 3; c++) {
            if (board[r][c] && board[r][c] === board[r+1][c+1] && board[r][c] === board[r+2][c+2] && board[r][c] === board[r+3][c+3]) return board[r][c];
        }
    }
    for (let r = 0; r < rows - 3; r++) {
        for (let c = 3; c < cols; c++) {
            if (board[r][c] && board[r][c] === board[r+1][c-1] && board[r][c] === board[r+2][c-2] && board[r][c] === board[r+3][c-3]) return board[r][c];
        }
    }
    return null;
}

function isBoardFullC4(board) { return board[0].every(cell => cell !== null); }

function evaluateRPSRound(m1, m2) {
    if (m1 === m2) return 'draw';
    if ((m1 === 'rock' && m2 === 'scissors') || 
        (m1 === 'paper' && m2 === 'rock') || 
        (m1 === 'scissors' && m2 === 'paper')) return 'X';
    return 'O';
}

client.login(process.env.TOKEN);
