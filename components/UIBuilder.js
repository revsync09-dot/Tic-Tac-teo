const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

class UIBuilder {
    constructor(emojis, client) {
        this.emojis = emojis;
        this.client = client;
    }

    formatEmoji(id, fallback) {
        if (!id || id.length < 10) return fallback;
        const cleanId = id.replace(/[^\d]/g, '');
        if (!cleanId) return fallback;
        const emoji = this.client.emojis.cache.get(cleanId);
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
        const titleEmoji = winner ? this.formatEmoji(this.emojis.WIN, '👑') : (isDraw ? this.formatEmoji(this.emojis.DRAW, '🤝') : this.formatEmoji(this.emojis.UI_TITLE, '⚔️'));
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        
        const titleText = winner ? ` ${gameName} VICTORY ` : (isDraw ? ` ${gameName} DRAW ` : ` ${gameName} ACTIVE `);
        
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\`${titleText}\`**\n\n` +
                `┃ 👥 **\` Players \`**\n` +
                `┃ ❌ **<@${playerX.id}>**\n` +
                `┃ ⭕ **<@${playerO.id}>**\n\n` +
                `┃ ${gearEmoji} **\` Status \`**\n` +
                `\`\`\`diff\n` +
                (winner || isDraw ? `+ Game Over\n` : `+ Turn: @${turn.username}\n`) +
                `\`\`\`\n`
            )
            .setImage(`attachment://${imageName}`)
            .setTimestamp();
    }

    createRPSStatusEmbed(playerX, playerO, scores, round, winner = null) {
        const titleEmoji = winner ? this.formatEmoji(this.emojis.WIN, '👑') : this.formatEmoji(this.emojis.UI_TITLE, '⚔️');
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        
        const titleText = winner ? ` RPS MATCH WINNER ` : ` RPS: ROUND ${round} `;

        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\`${titleText}\`**\n\n` +
                `┃ 👥 **\` Scores \`**\n` +
                `┃ ❌ **<@${playerX.id}>**  \` ${scores.X} Pts \`\n` +
                `┃ ⭕ **<@${playerO.id}>**  \` ${scores.O} Pts \`\n\n` +
                `┃ ${gearEmoji} **\` Format \`**\n` +
                `\`\`\`diff\n` +
                `+ Best of 3 (First to 2 points wins)\n` +
                `\`\`\`\n`
            )
            .setImage(`attachment://rps_v2.png`)
            .setTimestamp();
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
            new ButtonBuilder().setCustomId(`rps_${gameId}_rock`).setEmoji(getSafeEmoji(this.emojis.RPS_ROCK, '🪨')).setLabel('Rock').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`rps_${gameId}_paper`).setEmoji(getSafeEmoji(this.emojis.RPS_PAPER, '📄')).setLabel('Paper').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`rps_${gameId}_scissors`).setEmoji(getSafeEmoji(this.emojis.RPS_SCISSORS, '✂️')).setLabel('Scissors').setStyle(ButtonStyle.Primary).setDisabled(disabled)
        )];
    }

    createBSSetupEmbed(playerX, playerO, gs) {
        const titleEmoji = this.formatEmoji(this.emojis.BS_SHIP, '🚢');
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        
        const p1Ready = gs.ships.X.length === 5 ? 'READY' : 'SELECTING...';
        const p2Ready = gs.ships.O.length === 5 ? 'READY' : 'SELECTING...';

        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\` BATTLESHIP: DEPLOYMENT \`**\n\n` +
                `┃ 🛰️ **\` Satellite Uplink \`**\n` +
                `┃ ❌ **<@${playerX.id}>**  \` STATUS: ${p1Ready} \`\n` +
                `┃ ⭕ **<@${playerO.id}>**  \` STATUS: ${p2Ready} \`\n\n` +
                `┃ ${gearEmoji} **\` Mission Briefing \`**\n` +
                `\`\`\`diff\n` +
                `+ Deploy 5 Submarines to hidden coordinates.\n` +
                `+ Click your setup button to open tactical map.\n` +
                `\`\`\`\n`
            )
            .setTimestamp();
    }

    createBSSetupActionButtons(gameId, disabled = false) {
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bs_setup_X_${gameId}`).setLabel('🛠️ P1 Deployment').setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`bs_setup_O_${gameId}`).setLabel('🛠️ P2 Deployment').setStyle(ButtonStyle.Danger).setDisabled(disabled)
        )];
    }

    createBSGrid(gameId, pKey, selected, mode) {
        const rows = [];
        const letters = ['A', 'B', 'C', 'D', 'E'];
        
        for (let r = 0; r < 5; r++) {
            const row = new ActionRowBuilder();
            for (let c = 0; c < 5; c++) {
                const cellId = `${r}_${c}`;
                const isSelected = selected.includes(cellId);
                
                let btn = new ButtonBuilder()
                    .setCustomId(`bs_${mode}_${pKey}_${gameId}_${r}_${c}`)
                    .setLabel(`${letters[r]}${c+1}`);
                    
                if (mode === 'place') {
                    btn.setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
                       .setDisabled(isSelected || (selected.length >= 5));
                } else if (mode === 'attack') {
                    btn.setStyle(isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary)
                       .setDisabled(isSelected);
                }
                
                row.addComponents(btn);
            }
            rows.push(row);
        }
        return rows;
    }

    createBSStatusEmbed(gs) {
        const titleEmoji = gs.winner ? this.formatEmoji(this.emojis.WIN, '👑') : this.formatEmoji(this.emojis.BS_SHIP, '🚢');
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        
        const titleText = gs.winner ? ` BATTLESHIP: MISSION COMPLETE ` : ` BATTLESHIP: TACTICAL RADAR `;
        const p1Hits = gs.attacks.X.filter(a => gs.ships.O.includes(a)).length;
        const p2Hits = gs.attacks.O.filter(a => gs.ships.X.includes(a)).length;
        
        const bar = (hits) => {
            const total = 5;
            return "▰".repeat(hits) + "▱".repeat(total - hits);
        };

        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\`${titleText}\`**\n\n` +
                `┃ 📊 **\` Fleet Integrity \`**\n` +
                `┃ ❌ **<@${gs.players.X.id}>**  \`${bar(p1Hits)}\` \` ${p1Hits}/5 Hits \`\n` +
                `┃ ⭕ **<@${gs.players.O.id}>**  \`${bar(p2Hits)}\` \` ${p2Hits}/5 Hits \`\n\n` +
                `┃ ${gearEmoji} **\` Tactical Status \`**\n` +
                `\`\`\`diff\n` +
                (gs.winner ? `+ WINNER: @${gs.winner.username}\n` : `+ SCANNING FOR: @${gs.players[gs.turn].username}\n`) +
                `\`\`\`\n`
            )
            .setImage(`attachment://bs_v2.png`)
            .setTimestamp();
    }

    createVictoryAnnouncement(winner, streak, points, matchStats) {
        const titleEmoji = this.formatEmoji(this.emojis.WIN, '🏆');
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        const starEmoji = this.formatEmoji(this.emojis.RANK, '⭐');
        const rank = this.getRank(points);

        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\` MATCH CONCLUDED \`**\n\n` +
                `┃ 👑 **\` Winner \`**\n` +
                `┃ ❗ <@${winner.id}>\n\n` +
                `┃ ${gearEmoji} **\` Performance Stats \`**\n` +
                `\`\`\`diff\n` +
                `+ Rank:     ${rank.title}\n` +
                `+ Streak:   ${streak}\n` +
                `+ Points:   +3 (Total: ${points})\n` +
                `+ Fidelity: ${matchStats.moves || '?'} moves in ${matchStats.duration || '?'}s\n` +
                `\`\`\`\n` +
                `**\` ARENA PROFILE \`**\n` +
                `┃ 🔗 **\` Use /profile to view your ranking \`**`
            )
            .setTimestamp();
    }

    createDrawAnnouncement(p1, p2) {
        const drawEmoji = this.formatEmoji(this.emojis.DRAW, '🤝');
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${drawEmoji} **\` MATCH STALEMATE \`**\n\n` +
                `┃ ❗ **<@${p1.id}> & <@${p2.id}>**\n\n` +
                `\`\`\`diff\n` +
                `+ Both players earn +1 Point!\n` +
                `\`\`\`\n`
            )
            .setTimestamp();
    }

    createChallengeEmbed(challenger, target, gameName = 'Tic Tac Toe') {
        const titleEmoji = this.formatEmoji(this.emojis.UI_TITLE, '⚔️');
        const gameEmoji = this.formatEmoji(this.emojis.UI_GAME, '🎮');
        const infoEmoji = this.formatEmoji(this.emojis.UI_INFO, '❗');
        const gearEmoji = this.formatEmoji(this.emojis.UI_GEAR, '⚙️');
        
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\` BATTLE REQUEST \`**\n\n` +
                `┃ ${gameEmoji} **\` Game Type \`**\n` +
                `┃ ${infoEmoji} **\` ${gameName} \`**\n\n` +
                `┃ ${gearEmoji} **\` Duel Details \`**\n` +
                `\`\`\`diff\n` +
                `+ Challenger: @${challenger.username}\n` +
                `+ Target:     @${target.username}\n` +
                `+ Expires:    in 60 seconds\n` +
                `\`\`\`\n` +
                `**\` WAITING FOR TARGET \`**\n` +
                `┃ 🔗 **\` Click Accept Duel below to start \`**`
            )
            .setThumbnail(target.displayAvatarURL())
            .setTimestamp();
    }

    createChallengeButtons(challengerId, targetId, gameType = 'tictactoe') {
        const getSafeEmoji = (pref, fallback) => {
            if (!pref || pref.length < 10) return fallback;
            return pref.replace(/[^\d]/g, '');
        };
        const buttonEmoji = getSafeEmoji(this.emojis.UI_TITLE, '⚔️');
        
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${gameType}_${challengerId}_${targetId}`)
                .setLabel('Accept Duel')
                .setEmoji(buttonEmoji)
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
        const stopEmoji = this.formatEmoji(this.emojis.AFK_STOP, '🛑');
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${stopEmoji} **\` AFK FORFEIT \`**\n\n` +
                `┃ ❌ **<@${loser.id}> timed out!**\n\n` +
                `\`\`\`diff\n` +
                `+ Winner: @${winner.username} (by forfeit)\n` +
                `\`\`\`\n`
            )
            .setTimestamp();
    }

    createRankUpAnnouncement(user, oldR, newR) {
        const starEmoji = this.formatEmoji(this.emojis.RANK_UP, '⭐');
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${starEmoji} **\` RANK UP \`**\n\n` +
                `┃ 🎉 **<@${user.id}>**\n\n` +
                `\`\`\`diff\n` +
                `+ Promoted from ${oldR} to ${newR}!\n` +
                `\`\`\`\n`
            )
            .setTimestamp();
    }

    createStreakMilestoneAnnouncement(user, streak) {
        const fireEmoji = this.formatEmoji(this.emojis.STREAK, '🔥');
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${fireEmoji} **\` UNSTOPPABLE \`**\n\n` +
                `┃ 🚀 **<@${user.id}>**\n\n` +
                `\`\`\`diff\n` +
                `+ Currently on a ${streak} game win streak!\n` +
                `\`\`\`\n`
            )
            .setTimestamp();
    }
    
    createSystemEmbed(title, message, isError = false) {
        const emoji = isError ? this.formatEmoji(this.emojis.SYS_ERROR, '❌') : this.formatEmoji(this.emojis.SYS_WARNING, '⚠️');
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(`${emoji} **\` ${title} \`**\n\n┃ ❗ **${message}**`);
    }

    createUnoEmbed(gs) {
        const titleEmoji = gs.winner ? this.formatEmoji(this.emojis.WIN, '👑') : '🃏';
        const titleText = gs.winner ? ` UNO: CHAMPION DECLARED ` : ` UNO: TACTICAL MATCH `;
        
        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\`${titleText}\`**\n\n` +
                `┃ 👥 **\` Players \`**\n` +
                `┃ ❌ **<@${gs.players.X.id}>**  \` ${gs.players.X.hand.length} Cards \`\n` +
                `┃ ⭕ **<@${gs.players.O.id}>**  \` ${gs.players.O.hand.length} Cards \`\n\n` +
                `┃ 🃏 **\` Top Card \`**\n` +
                `\`\`\`diff\n` +
                `+ ${gs.discard[gs.discard.length - 1].color.toUpperCase()} ${gs.discard[gs.discard.length - 1].value.toUpperCase()}\n` +
                `\`\`\`\n` +
                `┃ ⚙️ **\` Status \`**\n` +
                `\`\`\`diff\n` +
                (gs.winner ? `+ WINNER: @${gs.winner.username}\n` : `+ Turn: @${gs.players[gs.turn].username}\n`) +
                `\`\`\`\n`
            )
            .setImage(`attachment://uno_v2.png`)
            .setTimestamp();
    }

    createUnoComponents(gs) {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`uno_view_hand_${gs.id}`).setLabel('View Hand').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`uno_draw_${gs.id}`).setLabel('Draw Card').setStyle(ButtonStyle.Danger)
            )
        ];
    }

    createUnoHandComponents(gs, pKey) {
        const hand = gs.players[pKey].hand;
        const page = gs.page[pKey] || 0;
        const perPage = 5;
        const maxPage = Math.ceil(hand.length / perPage) - 1;
        
        const row1 = new ActionRowBuilder();
        const start = page * perPage;
        const end = Math.min(start + perPage, hand.length);

        for (let i = start; i < end; i++) {
            const card = hand[i];
            const colors = { red: ButtonStyle.Danger, blue: ButtonStyle.Primary, green: ButtonStyle.Success, yellow: ButtonStyle.Secondary, black: ButtonStyle.Secondary };
            const labels = { skip: 'Ø', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
            
            row1.addComponents(
                new ButtonBuilder()
                    .setCustomId(`uno_play_${gs.id}_${i}`)
                    .setLabel(labels[card.value] || card.value)
                    .setStyle(colors[card.color])
                    .setDisabled(gs.turn !== pKey || gs.winner)
            );
        }

        const row2 = new ActionRowBuilder();
        row2.addComponents(
            new ButtonBuilder().setCustomId(`uno_page_${gs.id}_-1`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`uno_page_${gs.id}_1`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage || hand.length === 0)
        );

        return row1.components.length > 0 ? [row1, row2] : [row2];
    }

    createUnoWildComponents(gameId, cardIndex) {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`uno_wild_${gameId}_${cardIndex}_red`).setLabel('Red').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`uno_wild_${gameId}_${cardIndex}_blue`).setLabel('Blue').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`uno_wild_${gameId}_${cardIndex}_green`).setLabel('Green').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`uno_wild_${gameId}_${cardIndex}_yellow`).setLabel('Yellow').setStyle(ButtonStyle.Secondary)
            )
        ];
    }

    createLobbyEmbed(lobby) {
        const titleEmoji = '🏟️';
        const gearEmoji = '⚙️';
        
        const targetList = lobby.targets.map(u => {
            const joined = lobby.accepted.some(a => a.id === u.id);
            return `${joined ? '✅' : '⏳'} <@${u.id}>`;
        }).join('\n');

        return new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `${titleEmoji} **\` GAME LOBBY \`**\n\n` +
                `┃ 👑 **\` Host \`**\n` +
                `┃ <@${lobby.challenger.id}>\n\n` +
                `┃ 👥 **\` Invited Players \`**\n` +
                `${targetList}\n\n` +
                `┃ ${gearEmoji} **\` Status \`**\n` +
                `\`\`\`diff\n` +
                `+ Type: Uno (4-Player Table)\n` +
                `+ Players: ${lobby.accepted.length + 1} / 4\n` +
                `\`\`\`\n` +
                `**\` WAITING FOR PLAYERS \`**\n` +
                `┃ 🔗 **\` Click Join below to enter \`**`
            )
            .setTimestamp();
    }

    createLobbyButtons(challengerId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`join_${challengerId}`).setLabel('Join Game').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`start_${challengerId}`).setLabel('Start Match').setStyle(ButtonStyle.Primary)
        );
    }
}

module.exports = UIBuilder;
