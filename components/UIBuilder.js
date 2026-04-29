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

    createGameStatusEmbed(playerX, playerO, turn, winner = null, isDraw = false, gameName = 'Tic Tac Toe', imageName = 'board_v2.png') {
        const embed = new EmbedBuilder()
            .setColor(winner ? '#22c55e' : isDraw ? '#747f8d' : '#5865F2')
            .setTitle(winner ? `👑 ${gameName} VICTORY` : isDraw ? `🤝 ${gameName} DRAW` : `⚔️ ${gameName} ACTIVE`)
            .addFields(
                { name: `Player 1 (X)`, value: `<@${playerX.id}>`, inline: true },
                { name: `Player 2 (O)`, value: `<@${playerO.id}>`, inline: true },
                { name: `Current Turn`, value: winner || isDraw ? '🏁 Game Over' : `<@${turn.id}>`, inline: false }
            )
            .setImage(`attachment://${imageName}`)
            .setTimestamp();
        return embed;
    }

    createRPSStatusEmbed(playerX, playerO, scores, round, winner = null) {
        const embed = new EmbedBuilder()
            .setColor(winner ? '#22c55e' : '#5865F2')
            .setTitle(winner ? `👑 RPS MATCH WINNER` : `⚔️ RPS: ROUND ${round}`)
            .addFields(
                { name: `Player 1`, value: `<@${playerX.id}>\nScore: **${scores.X}**`, inline: true },
                { name: `Player 2`, value: `<@${playerO.id}>\nScore: **${scores.O}**`, inline: true },
            )
            .setImage(`attachment://rps_v2.png`)
            .setFooter({ text: 'Best of 3 - First to 2 points wins!' })
            .setTimestamp();
        return embed;
    }

    createC4Components(board, disabled = false, gameId = '') {
        const row1 = new ActionRowBuilder();
        const row2 = new ActionRowBuilder();
        for (let c = 0; c < 7; c++) {
            const isFull = board[0][c] !== null;
            const btn = new ButtonBuilder()
                .setCustomId(`c4_${gameId}_${c}`)
                .setLabel(`${c + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || isFull);
            if (c < 4) row1.addComponents(btn);
            else row2.addComponents(btn);
        }
        return [row1, row2];
    }

    createRPSComponents(gameId, disabled = false) {
        const getSafeEmoji = (pref, fallback) => {
            if (!pref || pref.length < 10) return fallback;
            return pref.replace(/[^\d]/g, '');
        };
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rps_${gameId}_rock`).setEmoji(getSafeEmoji(this.emojis.RPS_ROCK, '🪨')).setLabel('Stein').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`rps_${gameId}_paper`).setEmoji(getSafeEmoji(this.emojis.RPS_PAPER, '📄')).setLabel('Papier').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`rps_${gameId}_scissors`).setEmoji(getSafeEmoji(this.emojis.RPS_SCISSORS, '✂️')).setLabel('Schere').setStyle(ButtonStyle.Primary).setDisabled(disabled)
        )];
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

    createChallengeEmbed(challenger, target, gameName = 'Tic Tac Toe') {
        const emojiWin = this.formatEmoji(this.emojis.WIN, '🏆');
        return new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${emojiWin} BATTLE REQUEST`)
            .setDescription(`🔥 <@${challenger.id}> challenged <@${target.id}> to **${gameName}**!\n\nDo you accept? (Expires in 60s)`)
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: 'Hyperions Arena Duel' });
    }

    createChallengeButtons(challengerId, targetId, gameType = 'tictactoe') {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${gameType}_${challengerId}_${targetId}`)
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
