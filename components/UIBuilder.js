const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

class UIBuilder {
    constructor(emojis, client) {
        this.emojis = emojis;
        this.client = client;
        this.accentColor = '#5865F2';
        this.ranks = [
            { min: 100, title: 'GOD' },
            { min: 50, title: 'LEGEND' },
            { min: 20, title: 'ELITE' },
            { min: 0, title: 'ROOKIE' }
        ];
    }

    resolveEmoji(id, fallback, forceRawId = false) {
        if (!id || id.length < 10) return fallback;
        const cleanId = id.replace(/[^\d]/g, '');
        
        if (forceRawId) return cleanId;

        const found = this.client.emojis.cache.get(cleanId);
        if (found) return found.toString();
        
        // Force the embed to try rendering it even if not in cache
        return `<:custom:${cleanId}>`;
    }

    formatEmoji(id, fallback) {
        return this.resolveEmoji(id, fallback);
    }

    createGameButtons(board, disabled = false, gameId = '') {
        const rows = [];
        for (let r = 0; r < 3; r++) {
            const row = new ActionRowBuilder();
            for (let c = 0; c < 3; c++) {
                const cell = board[r][c];
                let emojiToUse;
                const getSafeEmoji = (pref, fallback) => {
                    if (!pref || pref.length < 10) return fallback;
                    return pref.replace(/[^\d]/g, ''); // Always use the raw ID for buttons
                };

                if (cell === 'X') emojiToUse = getSafeEmoji(this.emojis.X, '❌');
                else if (cell === 'O') emojiToUse = getSafeEmoji(this.emojis.O, '⭕');
                else emojiToUse = getSafeEmoji(this.emojis.EMPTY, '➖');

                const button = new ButtonBuilder()
                    .setCustomId(`${gameId}_${r}_${c}`)
                    .setEmoji(emojiToUse)
                    .setStyle(cell ? (cell === 'X' ? ButtonStyle.Primary : ButtonStyle.Danger) : ButtonStyle.Secondary)
                    .setDisabled(disabled || !!cell);
                row.addComponents(button);
            }
            rows.push(row);
        }
        return rows;
    }

    createGameStatusEmbed(playerX, playerO, turn, winner = null, isDraw = false, attachmentName = 'board_v2.png') {
        const emojiX = this.formatEmoji(this.emojis.X, '❌');
        const emojiO = this.formatEmoji(this.emojis.O, '⭕');
        const emojiSuccess = this.formatEmoji(this.emojis.SUCCESS, '✅');
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');

        const embed = new EmbedBuilder()
            .setColor(this.accentColor)
            .setTitle(`${emojiSuccess} Tic Tac Toe Battle`)
            .setImage(`attachment://${attachmentName}`);

        let description = `**Matchup:**\n${emojiX} <@${playerX.id}> **vs** ${emojiO} <@${playerO.id}>\n\n`;

        if (winner) {
            description += `🏆 **VICTORY!**\n<@${winner.id}> has claimed the throne!\n` +
                           `${emojiPoints} **Rewards:** +3 Points | Streak Increased!`;
            embed.setColor('#43b581');
        } else if (isDraw) {
            description += `🤝 **STALEMATE!**\nThe battle ends in a draw.\n` +
                           `${emojiPoints} **Rewards:** +1 Point for both warriors.`;
            embed.setColor('#747f8d');
        } else {
            description += `👉 **Current Turn:** <@${turn.id}>\nMake your move immediately to secure victory!`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: 'Hyperions Arena • v2.1 Nokia-Stability Mode' });
        return embed;
    }

    createVictoryAnnouncement(winner, streak, points, matchStats = {}) {
        const emojiWin = this.formatEmoji(this.emojis.WIN, '🏆');
        const emojiRank = this.formatEmoji(this.emojis.RANK, '🏅');
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');
        const emojiStreak = this.formatEmoji(this.emojis.STREAK, '🔥');
        const rank = this.getRankTitle(points);
        
        return new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle(`${emojiWin} WE HAVE A CHAMPION!`)
            .setDescription(
                `👑 **Winner:** <@${winner.id}>\n` +
                `${emojiRank} **Rank:** \`${rank}\`\n` +
                `${emojiStreak} **Current Streak:** ${streak}\n` +
                `${emojiPoints} **Points Earned:** +3\n\n` +
                `📊 **Match Stats:**\n` +
                `└ Moves: ${matchStats.moves || '?'}\n` +
                `└ Duration: ${matchStats.duration || '?'}s`
            )
            .setFooter({ text: 'Tournament Level Match' })
            .setTimestamp();
    }

    createLeaderboardEmbed(totalPlayers = 0, userRank = 'N/A', attachmentName = 'leaderboard_v2.png') {
        const emojiCrown = this.formatEmoji(this.emojis.CROWN, '👑');
        return new EmbedBuilder()
            .setColor(this.accentColor)
            .setTitle(`${emojiCrown} Hall of Legends`)
            .setDescription(
                `The top Tic Tac Toe legends of Hyperions.\n\n` +
                `🌍 **Global Players:** ${totalPlayers}\n` +
                `🎯 **Your Rank:** #${userRank}`
            )
            .setImage(`attachment://${attachmentName}`)
            .setFooter({ text: 'Updated every match' });
    }

    createReplayButton(player1Id, player2Id) {
        const rematchId = this.resolveEmoji(this.emojis.REMATCH, '🎮', true);
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`replay_${player1Id}_${player2Id}`)
                .setLabel('Rematch')
                .setEmoji(rematchId)
                .setStyle(ButtonStyle.Success)
        );
    }

    getRankTitle(points) {
        for (const r of this.ranks) {
            if (points >= r.min) return r.title;
        }
        return 'UNRANKED';
    }

    createDrawAnnouncement(player1, player2) {
        const emojiDraw = this.formatEmoji(this.emojis.DRAW, '🤝');
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');
        return new EmbedBuilder()
            .setColor('#747f8d')
            .setTitle(`${emojiDraw} LEGENDARY STALEMATE`)
            .setDescription(
                `🤝 **Warriors:** <@${player1.id}> & <@${player2.id}>\n` +
                `${emojiPoints} **Points Earned:** +1 each`
            )
            .setTimestamp();
    }
}

module.exports = UIBuilder;
