const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

class UIBuilder {
    constructor(emojis, client) {
        this.emojis = emojis;
        this.client = client;
    }

    formatEmoji(id, fallback) {
        if (!id || id.length < 10) return fallback;
        const emoji = this.client.emojis.cache.get(id.replace(/[^\d]/g, ''));
        return emoji ? emoji.toString() : fallback;
    }

    getRank(points) {
        if (points >= 100) return { title: 'GOD', color: '#ff0055' };
        if (points >= 50) return { title: 'LEGEND', color: '#a855f7' };
        if (points >= 20) return { title: 'ELITE', color: '#3b82f6' };
        if (points >= 0) return { title: 'ROOKIE', color: '#22c55e' };
        return { title: 'UNRANKED', color: '#6b7280' };
    }

    createGameComponents(board, disabled = false, gameId = '') {
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

                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${gameId}_${r}_${c}`)
                        .setEmoji(emojiToUse)
                        .setStyle(cell ? (cell === 'X' ? ButtonStyle.Primary : ButtonStyle.Danger) : ButtonStyle.Secondary)
                        .setDisabled(disabled || !!cell)
                );
            }
            rows.push(row);
        }
        return rows;
    }

    createGameStatusEmbed(playerX, playerO, turn, winner = null, isDraw = false) {
        const embed = new EmbedBuilder()
            .setColor(winner ? '#22c55e' : isDraw ? '#747f8d' : '#5865F2')
            .setTitle(winner ? '👑 VICTORY REACHED' : isDraw ? '🤝 DRAW' : '⚔️ ARENA ACTIVE')
            .addFields(
                { name: `Player 1 (X)`, value: `<@${playerX.id}>`, inline: true },
                { name: `Player 2 (O)`, value: `<@${playerO.id}>`, inline: true },
                { name: `Current Turn`, value: winner || isDraw ? '🏁 Game Over' : `<@${turn.id}>`, inline: false }
            )
            .setImage('attachment://board_v2.png')
            .setTimestamp();
        return embed;
    }

    createVictoryAnnouncement(winner, streak, points, matchStats) {
        const emojiRank = this.formatEmoji(this.emojis.RANK, '🏅');
        const emojiStreak = this.formatEmoji(this.emojis.STREAK, '🔥');
        const emojiPoints = this.formatEmoji(this.emojis.POINTS, '💰');
        const rank = this.getRank(points);

        return new EmbedBuilder()
            .setColor(rank.color)
            .setTitle('🏆 MATCH CONCLUDED')
            .setDescription(
                `👑 **Winner:** <@${winner.id}>\n` +
                `${emojiRank} **Rank:** \`${rank.title}\`\n` +
                `${emojiStreak} **Current Streak:** ${streak}\n` +
                `${emojiPoints} **Points Earned:** +3\n\n` +
                `${this.formatEmoji(this.emojis.STATS, '📊')} **Match:** ${matchStats.moves || '?'} moves in ${matchStats.duration || '?'}s\n\n` +
                `Use \`/profile\` to see your full stats!`
            )
            .setFooter({ text: 'Tournament Level Match' })
            .setTimestamp();
    }

    createDrawAnnouncement(p1, p2) {
        return new EmbedBuilder()
            .setColor('#747f8d')
            .setTitle('🤝 STALEMATE')
            .setDescription(`🤝 <@${p1.id}> & <@${p2.id}>\n\nBoth players earn **+1 Point**!`)
            .setTimestamp();
    }

    createChallengeEmbed(challenger, target) {
        const emojiWin = this.formatEmoji(this.emojis.WIN, '🏆');
        return new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${emojiWin} BATTLE REQUEST`)
            .setDescription(`🔥 <@${challenger.id}> challenged <@${target.id}>!\n\nDo you accept? (Expires in 60s)`)
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: 'Hyperions Arena Duel' });
    }

    createChallengeButtons(challengerId, targetId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_battle_${challengerId}_${targetId}`)
                .setLabel('Accept Duel')
                .setEmoji('⚔️')
                .setStyle(ButtonStyle.Primary)
        );
    }

    createReplayButton(p1Id, p2Id) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`replay_${p1Id}_${p2Id}`)
                .setLabel('Rematch')
                .setEmoji(this.formatEmoji(this.emojis.REMATCH, '🎮'))
                .setStyle(ButtonStyle.Success)
        );
    }

    createAfkForfeit(loser, winner) {
        return new EmbedBuilder()
            .setColor('#ef4444')
            .setTitle('🛑 AFK FORFEIT')
            .setDescription(`❌ <@${loser.id}> was too slow!\n👑 <@${winner.id}> wins by forfeit!`)
            .setTimestamp();
    }

    createRankUpAnnouncement(user, oldR, newR) {
        return new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('⭐ RANK UP')
            .setDescription(`🎉 <@${user.id}> promoted from \`${oldR}\` to \`${newR}\`!`)
            .setTimestamp();
    }

    createStreakMilestoneAnnouncement(user, streak) {
        return new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('🔥 UNSTOPPABLE')
            .setDescription(`🚀 <@${user.id}> is on a **${streak}** game win streak!`)
            .setTimestamp();
    }
}

module.exports = UIBuilder;
