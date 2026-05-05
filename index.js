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
const lobbies          = new Map(); // challengerId → { targets, accepted, type }

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

    // Battleship
    BS_SHIP:  process.env.EMOJI_BS_SHIP  || '🚢',
    BS_HIT:   process.env.EMOJI_BS_HIT   || '💥',
    BS_MISS:  process.env.EMOJI_BS_MISS  || '🌊',
    BS_WATER: process.env.EMOJI_BS_WATER || '🟦',

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
                return interaction.reply({ content: `${EMOJIS.SYS_DENIED} **Wrong Channel!** Use <#${GAME_CHANNEL_ID}>.`, ephemeral: true }).catch(() => null);
            }

            const { commandName } = interaction;

            if (['tictactoe', 'connect4', 'rps', 'battleship', 'uno'].includes(commandName)) {
                const now = Date.now();
                const cd = cooldowns.get(interaction.user.id) || 0;
                if (now < cd) return interaction.reply({ content: `${EMOJIS.SYS_COOLDOWN} Cooldown! Wait **${Math.ceil((cd - now) / 1000)}s**.`, ephemeral: true }).catch(() => null);

                if (commandName === 'uno') {
                    const targets = [
                        interaction.options.getUser('opponent1'),
                        interaction.options.getUser('opponent2'),
                        interaction.options.getUser('opponent3')
                    ].filter(u => u && !u.bot && u.id !== interaction.user.id);

                    if (targets.length === 0) return interaction.reply({ content: `${EMOJIS.SYS_ERROR} Invalid opponents.`, ephemeral: true }).catch(() => null);
                    
                    const lobby = { challenger: interaction.user, targets, accepted: [], type: 'uno', timer: null };
                    lobbies.set(interaction.user.id, lobby);
                    
                    const embed = UI.createLobbyEmbed(lobby);
                    const row = UI.createLobbyButtons(interaction.user.id);
                    await interaction.reply({ content: `${EMOJIS.UI_TITLE} Uno Lobby Created!`, embeds: [embed], components: [row] }).catch(() => null);
                    
                    lobby.timer = setTimeout(() => {
                        if (lobbies.has(interaction.user.id)) {
                            lobbies.delete(interaction.user.id);
                            interaction.editReply({ content: null, embeds: [UI.createSystemEmbed('LOBBY EXPIRED', 'The request timed out.', true)], components: [] }).catch(() => null);
                        }
                    }, 120_000);
                    return;
                }

                const opponent = interaction.options.getUser('opponent');
                if (!opponent || opponent.bot || opponent.id === interaction.user.id) return interaction.reply({ content: `${EMOJIS.SYS_ERROR} Invalid opponent.`, ephemeral: true }).catch(() => null);
                if (activeUsers.has(interaction.user.id)) return interaction.reply({ content: `${EMOJIS.UI_TITLE} You are already in a game!`, ephemeral: true }).catch(() => null);
                if (activeUsers.has(opponent.id)) return interaction.reply({ content: `${EMOJIS.UI_TITLE} Opponent is already in a game!`, ephemeral: true }).catch(() => null);

                cooldowns.set(interaction.user.id, now + COOLDOWN_MS);
                
                const gameNames = { tictactoe: 'Tic Tac Toe', connect4: 'Connect 4', rps: 'Rock Paper Scissors', battleship: 'Battleship' };
                const challengeEmbed = UI.createChallengeEmbed(interaction.user, opponent, gameNames[commandName]);
                const row = UI.createChallengeButtons(interaction.user.id, opponent.id, commandName);
                await interaction.reply({ content: `${EMOJIS.UI_TITLE} <@${opponent.id}>, you have been challenged!`, embeds: [challengeEmbed], components: [row] }).catch(() => null);

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
                const embed = new EmbedBuilder().setColor(UI.getRank(stats.points).color).setTitle(`${target.username}'s Arena Profile`).setImage('attachment://profile_v2.png');
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
            
            // LOBBY JOIN button
            if (interaction.customId.startsWith('join_')) {
                const challengerId = interaction.customId.split('_')[1];
                const lobby = lobbies.get(challengerId);
                if (!lobby) return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Lobby expired.`, ephemeral: true }).catch(() => null);
                
                if (!lobby.targets.some(u => u.id === interaction.user.id)) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} You are not invited!`, ephemeral: true }).catch(() => null);
                if (lobby.accepted.some(u => u.id === interaction.user.id)) return interaction.reply({ content: `${EMOJIS.SYS_WARNING} You already joined!`, ephemeral: true }).catch(() => null);
                
                lobby.accepted.push(interaction.user);
                await interaction.update({ embeds: [UI.createLobbyEmbed(lobby)], components: [UI.createLobbyButtons(challengerId)] }).catch(() => null);
                return;
            }

            // LOBBY START button
            if (interaction.customId.startsWith('start_')) {
                const challengerId = interaction.customId.split('_')[1];
                if (interaction.user.id !== challengerId) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} Only the host can start!`, ephemeral: true }).catch(() => null);
                
                const lobby = lobbies.get(challengerId);
                if (!lobby) return;
                if (lobby.accepted.length === 0) return interaction.reply({ content: `${EMOJIS.SYS_ERROR} At least 2 players required!`, ephemeral: true }).catch(() => null);
                
                clearTimeout(lobby.timer);
                lobbies.delete(challengerId);
                
                const players = [lobby.challenger, ...lobby.accepted];
                await interaction.deferUpdate().catch(() => null);
                await startMultiplayerGame(interaction, players, lobby.type);
                return;
            }

            // ACCEPT BATTLE button
            if (interaction.customId.startsWith('accept_')) {
                const parts = interaction.customId.split('_');
                const gameType = parts[1], challengerId = parts[2], targetId = parts[3];
                if (interaction.user.id !== targetId) return interaction.reply({ content: `${EMOJIS.SYS_ERROR} This is not your challenge!`, ephemeral: true }).catch(() => null);
                
                // Prevent spam clicks
                if (challengeLocks.has(targetId)) return;
                challengeLocks.add(targetId);

                const pending = challengesPending.get(targetId);
                if (!pending || pending.challengerId !== challengerId || pending.type !== gameType) {
                    challengeLocks.delete(targetId);
                    return interaction.reply({ content: `${EMOJIS.SYS_COOLDOWN} Challenge expired or invalid.`, ephemeral: true }).catch(() => null);
                }

                if (activeUsers.has(challengerId) || activeUsers.has(targetId)) {
                    challengeLocks.delete(targetId);
                    return interaction.reply({ content: `${EMOJIS.UI_TITLE} One of you is already in a game!`, ephemeral: true }).catch(() => null);
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
                if (clickerId !== p1Id && clickerId !== p2Id) return interaction.reply({ content: `${EMOJIS.SYS_ERROR} Not your game!`, ephemeral: true }).catch(() => null);

                const pairKey = [p1Id, p2Id].sort().join('_');
                const opponentId = clickerId === p1Id ? p2Id : p1Id;
                const cd = cooldowns.get(clickerId) || 0;
                if (Date.now() < cd) return interaction.reply({ content: `${EMOJIS.SYS_COOLDOWN} Cooldown! Wait **${Math.ceil((cd - Date.now()) / 1000)}s**.`, ephemeral: true }).catch(() => null);

                if (rematchPending.has(pairKey)) {
                    const pending = rematchPending.get(pairKey);
                    if (pending.initiatorId === clickerId) return interaction.reply({ content: `${EMOJIS.SYS_COOLDOWN} Waiting for opponent...`, ephemeral: true }).catch(() => null);
                    
                    clearTimeout(pending.timer); rematchPending.delete(pairKey);
                    if (activeUsers.has(p1Id) || activeUsers.has(p2Id)) return interaction.reply({ content: `${EMOJIS.UI_TITLE} Someone is in another game!`, ephemeral: true }).catch(() => null);
                    
                    await interaction.deferUpdate().catch(() => null);
                    const opponent = await client.users.fetch(opponentId).catch(() => null);
                    return startNewGame(interaction, opponent, pending.gameType || 'tictactoe');
                } else {
                    const lastGameType = activeUsers.get(pairKey) || 'tictactoe'; // Fallback
                    const timer = setTimeout(() => { rematchPending.delete(pairKey); }, 60_000);
                    rematchPending.set(pairKey, { initiatorId: clickerId, timer, gameType: interaction.message.embeds[0]?.title?.includes('Rock') ? 'rps' : (interaction.message.embeds[0]?.title?.includes('Connect') ? 'connect4' : (interaction.message.embeds[0]?.title?.includes('BATTLESHIP') ? 'battleship' : (interaction.message.embeds[0]?.title?.includes('Uno') ? 'uno' : 'tictactoe'))) });
                    return interaction.reply({ content: `${EMOJIS.UI_GAME} <@${clickerId}> wants a rematch! <@${opponentId}> — click **Rematch**!`, ephemeral: false }).catch(() => null);
                }
            }
            // UNO
            if (interaction.customId.startsWith('uno_')) {
                const parts = interaction.customId.split('_');
                const action = parts[1]; // play, draw, wild, page
                const gameId = parts[2];
                const gs = games.get(gameId);
                
                if (!gs) return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Game expired.`, ephemeral: true }).catch(() => null);
                if (interaction.user.id !== gs.players[gs.turn].id && action !== 'page') {
                    return interaction.reply({ content: `${EMOJIS.SYS_DENIED} Not your turn!`, ephemeral: true }).catch(() => null);
                }

                await handleUnoMove(interaction, gs, action, parts.slice(3));
                return;
            }
            // BATTLESHIP
            if (interaction.customId.startsWith('bs_setup_') || interaction.customId.startsWith('bs_place_') || interaction.customId.startsWith('bs_attack_')) {
                const parts = interaction.customId.split('_');
                const action = parts[1]; // setup, place, attack
                const pKey = parts[2]; // X, O
                const gameId = parts[3];
                const gs = games.get(gameId);
                
                if (!gs) return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Game expired.`, ephemeral: true }).catch(() => null);
                if (interaction.user.id !== gs.players[pKey].id) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} Not your board!`, ephemeral: true }).catch(() => null);

                if (action === 'setup') {
                    return interaction.reply({ 
                        content: `**Deployment Phase**\nHide your 5 Submarines by clicking on the grid below.`, 
                        components: UI.createBSGrid(gameId, pKey, gs.ships[pKey], 'place'),
                        ephemeral: true 
                    }).catch(() => null);
                }
                
                if (action === 'place') {
                    if (gs.status !== 'setup') return interaction.reply({ content: `${EMOJIS.SYS_WARNING} Game already started!`, ephemeral: true }).catch(() => null);
                    if (gs.ships[pKey].length >= 5) return interaction.reply({ content: `${EMOJIS.SYS_SUCCESS} Fleet already deployed!`, ephemeral: true }).catch(() => null);
                    
                    const r = parts[4], c = parts[5];
                    const cell = `${r}_${c}`;
                    if (!gs.ships[pKey].includes(cell)) gs.ships[pKey].push(cell);
                    
                    if (gs.ships[pKey].length === 5) {
                        await interaction.update({ content: `✅ Fleet deployed! Wait for opponent...`, components: UI.createBSGrid(gameId, pKey, gs.ships[pKey], 'place') }).catch(() => null);
                        if (gs.ships.X.length === 5 && gs.ships.O.length === 5) {
                            gs.status = 'playing';
                            gs.startTime = Date.now();
                            try {
                                const chan = await client.channels.fetch(gs.channelId);
                                const msg = await chan.messages.fetch(gs.mainMessageId);
                                const buffer = await GameEngine.renderBS(gs, EMOJIS);
                                const attachment = new AttachmentBuilder(buffer, { name: 'bs_v2.png' });
                                const embed = UI.createBSStatusEmbed(gs);
                                const components = UI.createBSGrid(gameId, gs.turn, gs.attacks[gs.turn], 'attack');
                                await msg.edit({ embeds: [embed], files: [attachment], components }).catch(() => null);
                                setupAfkTimers(gs);
                            } catch (e) { console.error('BS Start Error', e); }
                        }
                    } else {
                        await interaction.update({ 
                            content: `**Deployment Phase** (${gs.ships[pKey].length}/5 deployed)\nHide your 5 Submarines by clicking on the grid below.`, 
                            components: UI.createBSGrid(gameId, pKey, gs.ships[pKey], 'place')
                        }).catch(() => null);
                    }
                    return;
                }
                
                if (action === 'attack') {
                    await handleBSAttack(interaction, gs, pKey, parts[4], parts[5]);
                    return;
                }
            }

            // GAME MOVES
            const customId = interaction.customId;
            let gameId, action;
            const parts = customId.split('_');

            if (customId.startsWith('c4_')) {
                [, gameId, action] = parts;
            } else if (customId.startsWith('rps_')) {
                [, gameId, action] = parts;
            } else if (customId.startsWith('uno_')) {
                gameId = parts[2];
                action = parts[1];
                const gameState = games.get(gameId);
                if (!gameState) return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Game expired.`, ephemeral: true }).catch(() => null);
                await handleUnoMove(interaction, gameState, action, parts.slice(3));
                return;
            } else if (customId.startsWith('bs_')) {
                // Battleship handled above, but just in case
                return;
            } else {
                if (parts.length === 3) {
                    [gameId, action] = [parts[0], parts[1]];
                } else return;
            }

            const gameState = games.get(gameId);
            if (!gameState) return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Game expired.`, ephemeral: true }).catch(() => null);

            // Atomic Lock
            if (lockSet.has(gameId)) return;
            lockSet.add(gameId);

            try {
                if (gameState.type === 'tictactoe') {
                    await handleTTTMove(interaction, gameState, parts[1], parts[2]);
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
    if (interaction.user.id !== currentPlayer.id) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} **Not your turn!**`, ephemeral: true }).catch(() => null);
    
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
    if (interaction.user.id !== currentPlayer.id) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} **Not your turn!**`, ephemeral: true }).catch(() => null);
    
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
    const embed = UI.createGameStatusEmbed(gameState.players.X, gameState.players.O, gameState.players[gameState.turn], gameState.winner, gameState.isDraw, 'Connect 4', 'c4_board.png');

    await interaction.editReply({
        content: null, embeds: [embed], files: [attachment],
        components: UI.createC4Components(gameState.board, !!(gameState.winner || gameState.isDraw), gameState.id)
    }).catch(() => null);

    await finishGame(interaction, gameState, winnerKey, resX, resO);
}

async function handleRPSMove(interaction, gameState, move) {
    const isPlayerX = interaction.user.id === gameState.players.X.id;
    const isPlayerO = interaction.user.id === gameState.players.O.id;
    if (!isPlayerX && !isPlayerO) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} **Not your game!**`, ephemeral: true }).catch(() => null);
    
    const pKey = isPlayerX ? 'X' : 'O';
    if (gameState.moves[pKey]) return interaction.reply({ content: `${EMOJIS.SYS_SUCCESS} You already picked **${gameState.moves[pKey]}**. Wait for your opponent!`, ephemeral: true }).catch(() => null);

    gameState.moves[pKey] = move;
    await interaction.reply({ content: `${EMOJIS.SYS_SUCCESS} Move locked: **${move}**.`, ephemeral: true }).catch(() => null);

    if (gameState.moves.X && gameState.moves.O) {
        clearTimeout(gameState.afkWarningTimer); clearTimeout(gameState.afkForfeitTimer);
        
        const winnerKey = evaluateRPSRound(gameState.moves.X, gameState.moves.O);
        let roundInfo = '';
        if (winnerKey === 'draw') {
            roundInfo = 'ROUND DRAW!';
        } else {
            gameState.scores[winnerKey]++;
            roundInfo = `${gameState.players[winnerKey].username} wins the round!`;
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
    } else {
        const buffer = await GameEngine.renderRPS(gameState.moves, gameState.players, 'Waiting for opponent...', EMOJIS);
        const attachment = new AttachmentBuilder(buffer, { name: 'rps_v2.png' });
        const embed = UI.createRPSStatusEmbed(gameState.players.X, gameState.players.O, gameState.scores, gameState.round, null);
        await interaction.message.edit({
            content: null, embeds: [embed], files: [attachment],
            components: UI.createRPSComponents(gameState.id, false)
        }).catch(() => null);
    }
}

async function handleBSAttack(interaction, gs, pKey, rStr, cStr) {
    if (gs.status !== 'playing') return interaction.reply({ content: `${EMOJIS.EVENT_EXPIRED} Game over or not started.`, ephemeral: true }).catch(() => null);
    if (gs.turn !== pKey) return interaction.reply({ content: `${EMOJIS.SYS_DENIED} Not your turn!`, ephemeral: true }).catch(() => null);

    // Atomic Lock
    if (lockSet.has(gs.id)) return interaction.reply({ content: `${EMOJIS.SYS_WARNING} Processing...`, ephemeral: true }).catch(() => null);
    lockSet.add(gs.id);

    try {
        const cell = `${rStr}_${cStr}`;
        if (gs.attacks[pKey].includes(cell)) {
            return interaction.reply({ content: `${EMOJIS.SYS_WARNING} You already attacked here!`, ephemeral: true }).catch(() => null);
        }

        await interaction.deferUpdate().catch(() => null);
        
        clearTimeout(gs.afkWarningTimer); clearTimeout(gs.afkForfeitTimer);
        gs.attacks[pKey].push(cell);
        gs.moveCount++;
        
        const opponentKey = pKey === 'X' ? 'O' : 'X';
        const isHit = gs.ships[opponentKey].includes(cell);
        
        let hitCount = 0;
        for (const atk of gs.attacks[pKey]) {
            if (gs.ships[opponentKey].includes(atk)) hitCount++;
        }
        
        if (hitCount === 5) gs.winner = gs.players[pKey];
        else gs.turn = opponentKey;

        const buffer = await GameEngine.renderBS(gs, EMOJIS);
        const attachment = new AttachmentBuilder(buffer, { name: 'bs_v2.png' });
        const embed = UI.createBSStatusEmbed(gs);
        
        const components = gs.winner ? [] : UI.createBSGrid(gs.id, gs.turn, gs.attacks[gs.turn], 'attack');
        
        await interaction.message.edit({ content: null, embeds: [embed], files: [attachment], components }).catch(() => null);

        if (gs.winner) {
            const loserKey = opponentKey;
            const [resX, resO] = await Promise.all([db.updateStats(gs.players[pKey].id, 'win'), db.updateStats(gs.players[loserKey].id, 'loss')]).catch(() => [null, null]);
            await finishGame(interaction, gs, pKey, resX, resO);
        } else {
            setupAfkTimers(gs);
        }
    } finally {
        lockSet.delete(gs.id);
    }
}

async function handleUnoMove(interaction, gs, action, params) {
    const pKey = interaction.user.id;
    const hand = gs.players[pKey].hand;
    const topCard = gs.discard[gs.discard.length - 1];

    if (action === 'page') {
        const dir = parseInt(params[0]);
        gs.page[pKey] = Math.max(0, gs.page[pKey] + dir);
        await interaction.update({ components: UI.createUnoHandComponents(gs, pKey) }).catch(() => null);
        return;
    }

    if (action === 'view_hand') {
        await interaction.reply({ 
            content: `**Your Uno Hand**\nTop Card: **${topCard.color.toUpperCase()} ${topCard.value.toUpperCase()}**`, 
            components: UI.createUnoHandComponents(gs, pKey), 
            ephemeral: true 
        }).catch(() => null);
        return;
    }

    if (action === 'draw') {
        const card = gs.deck.pop();
        hand.push(card);
        if (gs.deck.length === 0) {
            gs.deck = gs.discard.slice(0, -1);
            gs.discard = [topCard];
            shuffle(gs.deck);
        }
        await interaction.reply({ content: `You drew a **${card.color} ${card.value}**!`, ephemeral: true }).catch(() => null);
        
        // Move to next turn
        const nextIdx = getNextTurnIndex(gs);
        gs.turn = gs.playerOrder[nextIdx];
        
        await updateUnoGame(interaction, gs);
        return;
    }

    if (action === 'play') {
        const index = parseInt(params[0]);
        const card = hand[index];
        
        // Validation
        const isColorMatch = card.color === topCard.color || card.color === 'black' || (topCard.color === 'black' && topCard.chosenColor === card.color);
        const isValueMatch = card.value === topCard.value;
        
        if (!isColorMatch && !isValueMatch) {
            return interaction.reply({ content: `${EMOJIS.SYS_ERROR} You cannot play that card!`, ephemeral: true }).catch(() => null);
        }

        if (card.color === 'black') {
            // Wild card - need color selection
            return interaction.update({ content: `**Select a color!**`, components: UI.createUnoWildComponents(gs.id, index) }).catch(() => null);
        }

        await executeUnoPlay(interaction, gs, pKey, index);
    }

    if (action === 'wild') {
        const index = parseInt(params[0]);
        const chosenColor = params[1];
        const card = hand[index];
        card.chosenColor = chosenColor;
        await executeUnoPlay(interaction, gs, pKey, index);
    }
}

async function executeUnoPlay(interaction, gs, pKey, index) {
    const hand = gs.players[pKey].hand;
    const card = hand.splice(index, 1)[0];
    gs.discard.push(card);
    gs.moveCount++;
    
    let skip = false;
    let drawCount = 0;
    let reverse = false;

    if (card.value === 'skip') skip = true;
    if (card.value === 'reverse') {
        if (gs.playerOrder.length === 2) skip = true;
        else reverse = true;
    }
    if (card.value === 'draw2') { skip = true; drawCount = 2; }
    if (card.value === 'wild4') { skip = true; drawCount = 4; }

    if (reverse) gs.reverse = !gs.reverse;

    if (drawCount > 0) {
        const nextIdx = getNextTurnIndex(gs);
        const nextPKey = gs.playerOrder[nextIdx];
        for (let i = 0; i < drawCount; i++) {
            if (gs.deck.length === 0) {
                const top = gs.discard.pop();
                gs.deck = gs.discard;
                gs.discard = [top];
                shuffle(gs.deck);
            }
            gs.players[nextPKey].hand.push(gs.deck.pop());
        }
    }

    if (hand.length === 0) {
        gs.winner = gs.players[pKey];
        // Stats only for 1v1 usually, but let's just win
        await updateUnoGame(interaction, gs);
        await finishGame(interaction, gs, pKey);
        return;
    }

    // Move to next turn
    let moveBy = skip ? 2 : 1;
    for(let i=0; i<moveBy; i++) {
        const currentIdx = gs.playerOrder.indexOf(gs.turn);
        let nextIdx = gs.reverse ? (currentIdx - 1 + gs.playerOrder.length) % gs.playerOrder.length : (currentIdx + 1) % gs.playerOrder.length;
        gs.turn = gs.playerOrder[nextIdx];
    }

    await updateUnoGame(interaction, gs);
}

function getNextTurnIndex(gs) {
    const currentIdx = gs.playerOrder.indexOf(gs.turn);
    return gs.reverse ? (currentIdx - 1 + gs.playerOrder.length) % gs.playerOrder.length : (currentIdx + 1) % gs.playerOrder.length;
}

async function startMultiplayerGame(interaction, players, type) {
    const gameId = interaction.id;
    const gs = {
        id: gameId, type, players: {}, playerOrder: players.map(p => p.id),
        turn: players[0].id, winner: null, startTime: Date.now(), moveCount: 0,
        channelId: interaction.channelId, mainMessageId: interaction.message.id,
        reverse: false
    };
    
    players.forEach(p => { gs.players[p.id] = p; gs.players[p.id].hand = []; });

    if (type === 'uno') {
        gs.deck = createUnoDeck();
        shuffle(gs.deck);
        players.forEach(p => { gs.players[p.id].hand = gs.deck.splice(0, 7); });
        let topCard = gs.deck.pop();
        while (topCard.color === 'black') { gs.deck.unshift(topCard); topCard = gs.deck.pop(); }
        gs.discard = [topCard];
        gs.page = {}; players.forEach(p => gs.page[p.id] = 0);
    }

    games.set(gameId, gs);
    players.forEach(p => activeUsers.add(p.id));
    
    await updateUnoGame(interaction, gs);
}

async function updateUnoGame(interaction, gs) {
    const buffer = await GameEngine.renderUno(gs);
    const attachment = new AttachmentBuilder(buffer, { name: 'uno_v2.png' });
    const embed = UI.createUnoEmbed(gs);
    
    const components = UI.createUnoComponents(gs);
    
    try {
        const chan = await client.channels.fetch(gs.channelId);
        const msg = await chan.messages.fetch(gs.mainMessageId);
        await msg.edit({ embeds: [embed], files: [attachment], components }).catch(() => null);
    } catch (e) { console.error('Uno Update Error', e); }

    if (interaction.isButton() && interaction.deferred) {
        // If we were in an ephemeral hand, we might want to close it or update it
        await interaction.editReply({ content: `✅ Move processed!`, components: [] }).catch(() => null);
    } else if (interaction.isButton() && !interaction.replied) {
         await interaction.update({ content: `✅ Move processed!`, components: [] }).catch(() => null);
    }
    
    setupAfkTimers(gs);
}

function createUnoDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];
    for (const color of colors) {
        deck.push({ color, value: '0' });
        for (let i = 1; i <= 9; i++) {
            deck.push({ color, value: i.toString() });
            deck.push({ color, value: i.toString() });
        }
        for (const action of ['skip', 'reverse', 'draw2']) {
            deck.push({ color, value: action });
            deck.push({ color, value: action });
        }
    }
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'black', value: 'wild' });
        deck.push({ color: 'black', value: 'wild4' });
    }
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function finishGame(interaction, gameState, winnerKey, resX, resO) {
    if (!gameState.winner && !gameState.isDraw) {
        setupAfkTimers(gameState);
        return;
    }
    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
    const matchStats = { moves: gameState.moveCount || gameState.round || 0, duration };
    
    // For 2-player games, provide a replay button
    let replayRow = null;
    if (gameState.playerOrder && gameState.playerOrder.length === 2) {
        replayRow = UI.createReplayButton(gameState.playerOrder[0], gameState.playerOrder[1]);
    } else if (gameState.players.X && gameState.players.O) {
        replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);
    }
    
    if (gameState.winner) {
        const winData = (winnerKey === 'X' ? resX : (winnerKey === 'O' ? resO : null));
        const winEmbed = UI.createVictoryAnnouncement(gameState.winner, winData?.data?.current_streak || 1, winData?.data?.points || 0, matchStats);
        
        const payload = { embeds: [winEmbed] };
        if (replayRow) payload.components = [replayRow];
        
        if (gameState.type === 'rps') {
            await interaction.channel.send(payload).catch(() => null);
        } else {
            await interaction.followUp(payload).catch(() => null);
        }
    } else {
        const p1 = gameState.players.X || gameState.players[gameState.playerOrder[0]];
        const p2 = gameState.players.O || gameState.players[gameState.playerOrder[1]];
        const drawEmbed = UI.createDrawAnnouncement(p1, p2);
        
        const payload = { embeds: [drawEmbed] };
        if (replayRow) payload.components = [replayRow];

        if (gameState.type === 'rps') {
            await interaction.channel.send(payload).catch(() => null);
        } else {
            await interaction.followUp(payload).catch(() => null);
        }
    }
    cleanupGame(gameState.id);
}

async function startNewGame(interaction, opponent, type = 'tictactoe') {
    const gameId = interaction.id;
    const playerX = interaction.user;
    
    const gameState = {
        id: gameId, type, players: { X: playerX, O: opponent },
        turn: 'X', winner: null, isDraw: false, startTime: Date.now(), moveCount: 0,
        channelId: interaction.channelId,
        mainMessageId: interaction.message.id
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
    } else if (type === 'battleship') {
        gameState.status = 'setup';
        gameState.ships = { X: [], O: [] };
        gameState.attacks = { X: [], O: [] };
    } else if (type === 'uno') {
        gameState.deck = createUnoDeck();
        shuffle(gameState.deck);
        gameState.players.X.hand = gameState.deck.splice(0, 7);
        gameState.players.O.hand = gameState.deck.splice(0, 7);
        let topCard = gameState.deck.pop();
        while (topCard.color === 'black') { gameState.deck.unshift(topCard); topCard = gameState.deck.pop(); }
        gameState.discard = [topCard];
        gameState.page = { X: 0, O: 0 };
        gameState.drawCount = 0; // for draw2/draw4 stacking if we want it, or just simple
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
            embed = UI.createGameStatusEmbed(playerX, opponent, playerX, null, false, 'Connect 4', 'c4_board.png');
            components = UI.createC4Components(gameState.board, false, gameId);
        } else if (type === 'rps') {
            buffer = await GameEngine.renderRPS(gameState.moves, gameState.players, 'Choose your action!', EMOJIS);
            attachment = new AttachmentBuilder(buffer, { name: 'rps_v2.png' });
            embed = UI.createRPSStatusEmbed(playerX, opponent, gameState.scores, gameState.round);
            components = UI.createRPSComponents(gameId, false);
        } else if (type === 'battleship') {
            embed = UI.createBSSetupEmbed(playerX, opponent, gameState);
            components = UI.createBSSetupActionButtons(gameId);
            attachment = null;
        } else if (type === 'uno') {
            buffer = await GameEngine.renderUno(gameState);
            attachment = new AttachmentBuilder(buffer, { name: 'uno_v2.png' });
            embed = UI.createUnoEmbed(gameState);
            components = UI.createUnoComponents(gameState, 'X');
        }

        const msgPayload = { content: null, embeds: [embed], components };
        if (attachment) msgPayload.files = [attachment];
        
        await interaction.editReply(msgPayload).catch(() => null);
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
                : (gs.players[gs.turn]?.id || gs.turn);
            chan.send({ embeds: [UI.createSystemEmbed('AFK WARNING', `<@${warningTarget}> you have 15 seconds to make your move! Fail to move and you will forfeit the game!`)] }).catch(() => null);
        }
    }, AFK_WARNING_MS);

    gs.afkForfeitTimer = setTimeout(async () => {
        const loserKey = gs.type === 'rps' 
            ? (!gs.moves.X ? 'X' : 'O')
            : gs.turn;
            
        let winner;
        if (gs.playerOrder && gs.playerOrder.length > 2) {
            // In multi-player, just end the game if someone is AFK
            winner = null;
        } else {
            const winnerKey = loserKey === 'X' ? 'O' : (gs.playerOrder ? gs.playerOrder.find(id => id !== loserKey) : (loserKey === gs.players.X.id ? gs.players.O.id : gs.players.X.id));
            winner = gs.players[winnerKey];
        }

        const loser = gs.players[loserKey];
        if (winner && loser) {
            await db.updateStats(winner.id, 'win').catch(() => null); 
            await db.updateStats(loser.id, 'loss').catch(() => null);
        }

        const chan = client.channels.cache.get(GAME_CHANNEL_ID);
        if (chan) {
            if (winner && loser) chan.send({ embeds: [UI.createAfkForfeit(loser, winner)], components: [] }).catch(() => null);
            else if (loser) chan.send({ embeds: [UI.createSystemEmbed('GAME ENDED', `<@${loser.id}> was AFK. Game closed.`, true)] }).catch(() => null);
        }
        cleanupGame(gs.id);
    }, AFK_FORFEIT_MS);
}

function cleanupGame(gameId) {
    const gs = games.get(gameId);
    if (gs) {
        if (gs.playerOrder) {
            gs.playerOrder.forEach(id => activeUsers.delete(id));
        } else {
            if (gs.players.X) activeUsers.delete(gs.players.X.id);
            if (gs.players.O) activeUsers.delete(gs.players.O.id);
        }
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
