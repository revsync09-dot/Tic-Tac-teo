require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    AttachmentBuilder 
} = require('discord.js');

const GameEngine = require('./components/GameEngine');
const UIBuilder = require('./components/UIBuilder');
const db = require('./db');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers],
    failIfNotExists: false
});

client.on('error', error => console.error('🛡️ SHIELD ERROR:', error));
process.on('unhandledRejection', error => console.error('🛡️ SHIELD REJECTION:', error));

const games = new Map();
const cooldowns = new Map();
const GUILD_ID = process.env.GUILD_ID;

const EMOJIS = {
    X: process.env.EMOJI_X || '❌',
    O: process.env.EMOJI_O || '⭕',
    WIN: process.env.EMOJI_WIN || '🏆',
    RANK: process.env.EMOJI_RANK || '🎖️',
    POINTS: process.env.EMOJI_POINTS || '💰',
    STREAK: process.env.EMOJI_STREAK || '🔥',
    REMATCH: process.env.EMOJI_REMATCH || '🎮',
    DRAW: process.env.EMOJI_DRAW || '🤝',
    CROWN: process.env.EMOJI_CROWN || '👑',
    SUCCESS: process.env.EMOJI_SUCCESS || '✅',
    ERROR: process.env.EMOJI_ERROR || '❌',
    EMPTY: process.env.EMOJI_EMPTY || '➖'
};

const UI = new UIBuilder(EMOJIS, client);

client.once('ready', async () => {
    console.log(`🚀 TIC TAC TEO V2.1 ACTIVE AS ${client.user.tag}!`);
    if (GUILD_ID) {
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            await guild.emojis.fetch();
            console.log(`✅ SYNCED: ${guild.name} (${guild.emojis.cache.size} emojis)`);
        } catch (e) {
            console.error('❌ SYNC FAILED:', e.message);
        }
    }
    console.log('📦 PRE-CACHING ASSETS...');
    Promise.all([
        GameEngine.getEmojiImage(EMOJIS.X),
        GameEngine.getEmojiImage(EMOJIS.O),
        GameEngine.getEmojiImage(EMOJIS.CROWN),
        GameEngine.getEmojiImage(EMOJIS.SUCCESS),
        GameEngine.getEmojiImage(EMOJIS.ERROR)
    ]).then(() => console.log('💎 ASSETS READY!'));
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'tictactoe') {
                const now = Date.now();
                const cooldown = cooldowns.get(interaction.user.id) || 0;
                if (now < cooldown) {
                    return interaction.reply({ 
                        content: `⏳ **Cooldown!** Try again in ${Math.ceil((cooldown - now) / 1000)}s.`, 
                        ephemeral: true 
                    }).catch(() => null);
                }
                cooldowns.set(interaction.user.id, now + 5000); // 5s
                await startNewGame(interaction, interaction.options.getUser('opponent'));
            }

            if (interaction.commandName === 'leaderboard') {
                await interaction.reply({ content: '🏆 Accessing Hall of Legends...', ephemeral: false }).catch(() => null);
                try {
                    const [topPlayers, strongest, total, userRank] = await Promise.all([
                        db.getLeaderboard(),
                        db.getStrongestPlayer(),
                        db.getTotalGames(),
                        db.getUserRank(interaction.user.id)
                    ]);
                    
                    const userData = await Promise.all(topPlayers.map(p => client.users.fetch(p.user_id).catch(() => null)));
                    const buffer = await GameEngine.renderLeaderboard(topPlayers, userData.filter(u => u !== null), EMOJIS, strongest?.user_id);
                    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard_v2.png' });
                    
                    const embed = UI.createLeaderboardEmbed(total, userRank);
                    if (strongest) {
                        embed.addFields({ name: '👑 Strongest Player', value: `<@${strongest.user_id}> (Streak: ${strongest.highest_streak})`, inline: false });
                    }

                    await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
                } catch (err) {
                    console.error('Leaderboard Error:', err);
                    await interaction.editReply({ content: '❌ System busy.' });
                }
            }
        }

        if (interaction.isButton()) {
            // ALWAYS ACKNOWLEDGE IMMEDIATELY (Fixes 'InteractionNotReplied')
            if (interaction.customId.startsWith('replay_')) {
                const [_, p1Id, p2Id] = interaction.customId.split('_');
                if (interaction.user.id !== p1Id && interaction.user.id !== p2Id) {
                    return interaction.reply({ content: "Only original warriors can rematch!", ephemeral: true }).catch(() => null);
                }
                await interaction.deferUpdate().catch(() => null);
                const opponent = await client.users.fetch(interaction.user.id === p1Id ? p2Id : p1Id);
                return startNewGame(interaction, opponent);
            }

            const [gameId, row, col] = interaction.customId.split('_');
            const gameState = games.get(gameId);
            
            if (!gameState) {
                return interaction.reply({ content: "🏟️ **Arena Closed.** Game expired.", ephemeral: true }).catch(() => null);
            }

            // Turn check
            const currentPlayer = gameState.players[gameState.turn];
            if (interaction.user.id !== currentPlayer.id) {
                return interaction.reply({ content: `🚫 **Wait your turn!** <@${currentPlayer.id}> is thinking.`, ephemeral: true }).catch(() => null);
            }

            if (gameState.processing) return interaction.deferUpdate().catch(() => null);

            // Start processing and DEFER UPDATE
            gameState.processing = true;
            await interaction.deferUpdate().catch(() => null);

            const r = parseInt(row), c = parseInt(col);
            if (gameState.board[r][c]) {
                gameState.processing = false;
                return;
            }

            gameState.board[r][c] = gameState.turn;
            gameState.moveCount++;
            
            const winnerKey = checkWinner(gameState.board);
            let resultDataX, resultDataO;

            if (winnerKey) {
                gameState.winner = gameState.players[winnerKey];
                [resultDataX, resultDataO] = await Promise.all([
                    db.updateStats(gameState.players[winnerKey].id, 'win'),
                    db.updateStats(gameState.players[winnerKey === 'X' ? 'O' : 'X'].id, 'loss')
                ]);
            } else if (isBoardFull(gameState.board)) {
                gameState.isDraw = true;
                [resultDataX, resultDataO] = await Promise.all([
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

                if (gameState.winner || gameState.isDraw) {
                    const duration = Math.round((Date.now() - gameState.startTime) / 1000);
                    const stats = { moves: gameState.moveCount, duration };
                    
                    if (gameState.winner) {
                        const winEmbed = UI.createVictoryAnnouncement(gameState.winner, resultDataX?.current_streak || 1, resultDataX?.points || 0, stats);
                        const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);
                        await interaction.followUp({ embeds: [winEmbed], components: [replayRow] }).catch(() => null);
                    } else {
                        const drawEmbed = UI.createDrawAnnouncement(gameState.players.X, gameState.players.O);
                        const replayRow = UI.createReplayButton(gameState.players.X.id, gameState.players.O.id);
                        await interaction.followUp({ embeds: [drawEmbed], components: [replayRow] }).catch(() => null);
                    }
                }
            } catch (err) {
                console.error('Final Render Error:', err);
            }

            gameState.processing = false;
            if (gameState.winner || gameState.isDraw) games.delete(gameId);
        }
    } catch (err) {
        console.error('🛑 CRITICAL ERROR:', err);
    }
});

async function startNewGame(interaction, opponent) {
    try {
        if (opponent.bot || opponent.id === (interaction.user?.id || (interaction.member && interaction.member.id))) {
            return interaction.reply({ content: "Invalid challenge!", ephemeral: true }).catch(() => null);
        }

        const replyMethod = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
        await interaction[replyMethod]({ content: '🛡️ **Initializing Battle...**', ephemeral: false, embeds: [], components: [], files: [] }).catch(() => null);

        const gameId = interaction.id;
        const gameState = {
            id: gameId,
            players: { X: interaction.user || interaction.member.user, O: opponent },
            board: Array(3).fill(null).map(() => Array(3).fill(null)),
            turn: 'X',
            winner: null,
            isDraw: false,
            processing: false,
            startTime: Date.now(),
            moveCount: 0
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

        setTimeout(() => { if (games.has(gameId)) games.delete(gameId); }, 300000);
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
