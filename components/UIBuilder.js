const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

class UIBuilder {
    constructor(emojis, client) {
        this.emojis = emojis;
        this.client = client;
        this.accentColor = '#5865F2';
        this.ranks = [
            { min: 100, title: 'GOD',     color: '#ff0055' },
            { min: 50,  title: 'LEGEND',  color: '#a855f7' },
            { min: 20,  title: 'ELITE',   color: '#3b82f6' },
            { min: 0,   title: 'ROOKIE',  color: '#22c55e' }
        ];
    }

    resolveEmoji(id, fallback, forceRawId = false) {
        if (!id || id.length < 10) return fallback;
        const cleanId = id.replace(/[^\d]/g, '');
        if (forceRawId) return cleanId;
        const found = this.client.emojis.cache.get(cleanId);
        if (found) return found.toString();
        return `<:custom:${cleanId}>`;
    }

    formatEmoji(id, fallback) {
        return this.resolveEmoji(id, fallback);
    }

    getRank(points) {
        for (const r of this.ranks) {
            if (points >= r.min) return r;
        }
        return { title: 'UNRANKED', color: '#6b7280' };
    }

    createGameButtons(board, disabled = false, gameId = '') {
        const rows = [];
        for (let r = 0; r < 3; r++) {
            const row = new ActionRowBuilder();
            for (let c = 0; c < 3; c++) {
                const cell = board[r][c];
                const getSafeEmoji = (pref, fallback) => {
                    if (!pref || pref.length < 10) return fallback;
                    return pref.replace(/[^\d]/g, '');
                };
                let emojiToUse;
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
            description += `🏆 **VICTORY!**\n<@${winner.id}> has claimed the throne!\n${emojiPoints} **+3 Points** added to your rank!`;
            embed.setColor('#43b581');
        } else if (isDraw) {
            description += `🤝 **STALEMATE!**\nA legendary draw.\n${emojiPoints} **+1 Point** for both warriors.`;
            embed.setColor('#747f8d');
        } else {
            description += `👉 **Turn:** <@${turn.id}> — Make your move!`;
        }
        embed.setDescription(description);
        embed.setFooter({ text: 'Hyperions Arena • v2.1' });
        return embed;
    }

    createVictoryAnnouncement(winner, streak, points, matchStats = {}) {
        const emojiWin = this.formatEmoji(this.emojis.WIN, '🏆');
        const emojiRank = this.formatEmoji(this.emojis.RANK, '🏅');
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');
        const emojiStreak = this.formatEmoji(this.emojis.STREAK, '🔥');
        const rank = this.getRank(points);

        return new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle(`${emojiWin} WE HAVE A CHAMPION!`)
            .setDescription(
                `👑 **Winner:** <@${winner.id}>\n` +
                `${emojiRank} **Rank:** \`${rank.title}\`\n` +
                `${emojiStreak} **Current Streak:** ${streak}\n` +
                `${emojiPoints} **Points Earned:** +3\n\n` +
                `📊 **Match:** ${matchStats.moves || '?'} moves in ${matchStats.duration || '?'}s\n\n` +
                `Use \`/profile\` to see your full stats!`
            )
            .setFooter({ text: 'Tournament Level Match' })
            .setTimestamp();
    }

    // ─── FEATURE: RANK UP ──────────────────────────────────────────────────
    createRankUpAnnouncement(user, oldRank, newRank) {
        const colors = { GOD: '#ff0055', LEGEND: '#a855f7', ELITE: '#3b82f6', ROOKIE: '#22c55e' };
        return new EmbedBuilder()
            .setColor(colors[newRank] || '#ffffff')
            .setTitle('⚡ RANK UP!')
            .setDescription(
                `🎉 **Congratulations** <@${user.id}>!\n\n` +
                `You have advanced from **${oldRank}** → **${newRank}**!\n` +
                `Keep climbing — the \`GOD\` tier awaits you!`
            )
            .setTimestamp();
    }

    // ─── FEATURE: STREAK MILESTONE ─────────────────────────────────────────
    createStreakMilestoneAnnouncement(user, streak) {
        const emojiStreak = this.formatEmoji(this.emojis.STREAK, '🔥');
        return new EmbedBuilder()
            .setColor('#ff4500')
            .setTitle(`${emojiStreak} UNSTOPPABLE STREAK!`)
            .setDescription(
                `🔥 <@${user.id}> has reached a **${streak} WIN STREAK**!\n\n` +
                `${streak >= 10 ? '👑 **LEGENDARY PERFORMANCE!** Is anyone able to stop this warrior?' : '⚡ Can they keep it going?'}`
            )
            .setTimestamp();
    }

    // ─── FEATURE: AFK WARNING ──────────────────────────────────────────────
    createAfkWarning(player, seconds) {
        return new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏳ AFK Warning!')
            .setDescription(
                `<@${player.id}> you have **${seconds} seconds** to make your move!\n` +
                `Fail to move and you will **forfeit the game!**`
            );
    }

    createAfkForfeit(player, winner) {
        return new EmbedBuilder()
            .setColor('#ef4444')
            .setTitle('💀 AFK Forfeit!')
            .setDescription(
                `<@${player.id}> did not respond in time!\n\n` +
                `🏆 <@${winner.id}> wins by **forfeit**!`
            )
            .setTimestamp();
    }

    createLeaderboardEmbed(totalPlayers = 0, userRank = 'N/A', attachmentName = 'leaderboard_v2.png') {
        const emojiCrown = this.formatEmoji(this.emojis.CROWN, '👑');
        return new EmbedBuilder()
            .setColor(this.accentColor)
            .setTitle(`${emojiCrown} Hall of Legends`)
            .setDescription(
                `The top Tic Tac Toe legends of Hyperions.\n\n` +
                `🌍 **Registered Players:** ${totalPlayers}\n` +
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

    createDrawAnnouncement(player1, player2) {
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');
        return new EmbedBuilder()
            .setColor('#747f8d')
            .setTitle('🤝 LEGENDARY STALEMATE')
            .setDescription(
                `🤝 **Warriors:** <@${player1.id}> & <@${player2.id}>\n` +
                `${emojiPoints} **+1 Point** for both players\n\n` +
                `Use \`/profile\` to see your stats!`
            )
            .setTimestamp();
    }
}

module.exports = UIBuilder;
