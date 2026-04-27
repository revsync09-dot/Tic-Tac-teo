const { createCanvas, loadImage } = require('canvas');

class GameEngine {
    constructor() {
        this.emojiCache = new Map();
    }

    async getEmojiImage(id) {
        if (!id || id.length < 10) return null;
        if (this.emojiCache.has(id)) return this.emojiCache.get(id);
        try {
            const cleanId = id.replace(/[^\d]/g, '');
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000));
            const img = await Promise.race([
                loadImage(`https://cdn.discordapp.com/emojis/${cleanId}.png`),
                timeout
            ]).catch(() => null);
            if (img) this.emojiCache.set(id, img);
            return img;
        } catch (e) {
            return null;
        }
    }

    async renderBoard(board, emojis, players = {}, strongestId = null) {
        const size = 300;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0f1015';
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = '#2d2f3b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = 1; i < 3; i++) {
            ctx.moveTo(i * (size / 3), 10);
            ctx.lineTo(i * (size / 3), size - 10);
            ctx.moveTo(10, i * (size / 3));
            ctx.lineTo(size - 10, i * (size / 3));
        }
        ctx.stroke();

        const crownImg = await this.getEmojiImage(emojis.CROWN);
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const cell = board[r][c];
                if (!cell) continue;
                const playerObj = players[cell];
                const emojiId = cell === 'X' ? emojis.X : emojis.O;
                const img = await this.getEmojiImage(emojiId);
                const x = c * (size / 3) + 15;
                const y = r * (size / 3) + 15;
                const pSize = (size / 3) - 30;
                if (img) {
                    ctx.drawImage(img, x, y, pSize, pSize);
                    if (playerObj && playerObj.id === strongestId && crownImg) {
                        ctx.drawImage(crownImg, x + pSize - 15, y - 5, 25, 25);
                    }
                } else {
                    ctx.strokeStyle = cell === 'X' ? '#ff4757' : '#2ed573';
                    ctx.lineWidth = 5;
                    if (cell === 'X') {
                        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + pSize, y + pSize);
                        ctx.moveTo(x + pSize, y); ctx.lineTo(x, y + pSize); ctx.stroke();
                    } else {
                        ctx.beginPath(); ctx.arc(x + pSize/2, y + pSize/2, pSize/2, 0, Math.PI * 2); ctx.stroke();
                    }
                }
            }
        }
        return canvas.toBuffer();
    }

    // ─── FEATURE: PROFILE CARD ─────────────────────────────────────────────
    async renderProfileCard(user, stats, rankTitle, globalRank) {
        const W = 700, H = 280;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // Background gradient
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#0d0f16');
        bg.addColorStop(1, '#1a1e2e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Rank glow based on tier
        const rankColors = { GOD: '#ff0055', LEGEND: '#a855f7', ELITE: '#3b82f6', ROOKIE: '#22c55e', UNRANKED: '#6b7280' };
        const glow = rankColors[rankTitle] || '#6b7280';
        ctx.shadowColor = glow;
        ctx.shadowBlur = 30;
        ctx.strokeStyle = glow;
        ctx.lineWidth = 2;
        this.drawRoundedRect(ctx, 2, 2, W - 4, H - 4, 18);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Avatar circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, H / 2, 70, 0, Math.PI * 2);
        ctx.clip();
        try {
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarUrl);
            ctx.drawImage(avatar, 30, H / 2 - 70, 140, 140);
        } catch {
            ctx.fillStyle = '#2d2f3b';
            ctx.fill();
        }
        ctx.restore();

        // Rank badge arc around avatar
        ctx.strokeStyle = glow;
        ctx.lineWidth = 5;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(100, H / 2, 73, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Username
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Arial';
        ctx.fillText(user.username, 195, 70);

        // Rank tag
        ctx.fillStyle = glow;
        ctx.font = 'bold 20px Arial';
        ctx.fillText(`[ ${rankTitle} ]  #${globalRank} GLOBAL`, 195, 100);

        // Divider
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(195, 115);
        ctx.lineTo(W - 30, 115);
        ctx.stroke();

        // Stats grid
        const statItems = [
            { label: 'WINS', value: stats.wins, color: '#22c55e' },
            { label: 'LOSSES', value: stats.losses, color: '#ef4444' },
            { label: 'DRAWS', value: stats.draws, color: '#94a3b8' },
            { label: 'POINTS', value: stats.points, color: '#ffd700' },
        ];
        statItems.forEach((item, i) => {
            const x = 195 + i * 125;
            const y = 160;
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            this.drawRoundedRect(ctx, x, y, 110, 70, 10);
            ctx.fill();

            ctx.fillStyle = item.color;
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(item.value, x + 55, y + 38);

            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, x + 55, y + 60);
            ctx.textAlign = 'left';
        });

        // Win rate bar
        const wr = Math.round((stats.wins / (stats.wins + stats.losses + stats.draws || 1)) * 100);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        this.drawRoundedRect(ctx, 195, 245, W - 225, 20, 10);
        ctx.fill();
        const barGrad = ctx.createLinearGradient(195, 0, 195 + ((W - 225) * wr / 100), 0);
        barGrad.addColorStop(0, glow);
        barGrad.addColorStop(1, '#ffffff33');
        ctx.fillStyle = barGrad;
        this.drawRoundedRect(ctx, 195, 245, Math.max(20, (W - 225) * wr / 100), 20, 10);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Arial';
        ctx.fillText(`WIN RATE: ${wr}%  |  STREAK: ${stats.current_streak}  |  BEST: ${stats.highest_streak}`, 198, 260);

        // Footer
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText('Hyperions Arena • v2.1', W - 15, H - 8);
        ctx.textAlign = 'left';

        return canvas.toBuffer();
    }

    // ─── FEATURE: LEADERBOARD ──────────────────────────────────────────────
    async renderLeaderboard(topPlayers, users, emojis, strongestPlayerId) {
        const width = 800, height = 700;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#1a1c23');
        grad.addColorStop(1, '#0f1015');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px Arial';
        ctx.fillText('🏆 HALL OF LEGENDS', 50, 70);

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '18px Arial';
        ctx.fillText('The mightiest warriors of Hyperions', 50, 100);

        for (let i = 0; i < topPlayers.length; i++) {
            const player = topPlayers[i];
            const user = users.find(u => u.id === player.user_id);
            const y = 185 + i * 78;
            const isStrongest = player.user_id === strongestPlayerId;

            ctx.fillStyle = i === 0 ? 'rgba(255,215,0,0.08)' : isStrongest ? 'rgba(255,0,100,0.08)' : 'rgba(255,255,255,0.03)';
            this.drawRoundedRect(ctx, 40, y - 50, width - 80, 68, 14);
            ctx.fill();

            const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
            ctx.fillStyle = rankColors[i] || 'rgba(255,255,255,0.5)';
            ctx.font = 'bold 26px Arial';
            ctx.fillText(`#${i + 1}`, 65, y - 5);

            if (user) {
                try {
                    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 64 }));
                    ctx.save();
                    ctx.beginPath(); ctx.arc(148, y - 14, 22, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(avatar, 126, y - 36, 44, 44);
                    ctx.restore();
                } catch { /* skip */ }
            }

            ctx.fillStyle = isStrongest ? '#ff3e3e' : '#ffffff';
            ctx.font = `bold 20px Arial`;
            ctx.fillText(user ? (user.username + (isStrongest ? ' 👑 STRONGEST' : '')) : 'Unknown', 210, y - 15);

            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = '14px Arial';
            const wr = Math.round((player.wins / (player.wins + player.losses + player.draws || 1)) * 100);
            ctx.fillText(`W:${player.wins} L:${player.losses} D:${player.draws} | WR:${wr}% | Streak:${player.current_streak} (Best:${player.highest_streak})`, 210, y + 10);

            ctx.fillStyle = i === 0 ? '#ffd700' : '#ffffff';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(`${player.points} PTS`, width - 60, y - 5);
            ctx.textAlign = 'left';
        }

        return canvas.toBuffer();
    }

    drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }
}

module.exports = new GameEngine();
