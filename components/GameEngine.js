const { createCanvas, loadImage } = require('canvas');

class GameEngine {
    constructor() {
        this.emojiCache = new Map();
        this.bgCache = null;
    }

    async getEmojiImage(id) {
        if (!id || id.length < 10) return null;
        if (this.emojiCache.has(id)) return this.emojiCache.get(id);
        
        try {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000));
            const cleanId = id.replace(/[^\d]/g, '');
            const img = await Promise.race([
                loadImage(`https://cdn.discordapp.com/emojis/${cleanId}.png`),
                timeout
            ]).catch(() => null);
            
            if (img) this.emojiCache.set(id, img);
            return img;
        } catch (e) {
            console.error(`Failed to load emoji ${id}:`, e.message);
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
                    
                    // FEATURE: If player is STRONGEST, draw a crown on their piece
                    if (playerObj && playerObj.id === strongestId && crownImg) {
                        ctx.drawImage(crownImg, x + pSize - 15, y - 5, 25, 25);
                    }
                } else {
                    ctx.strokeStyle = cell === 'X' ? '#ff4757' : '#2ed573';
                    ctx.lineWidth = 5;
                    if (cell === 'X') {
                        ctx.beginPath();
                        ctx.moveTo(x, y); ctx.lineTo(x + pSize, y + pSize);
                        ctx.moveTo(x + pSize, y); ctx.lineTo(x, y + pSize);
                        ctx.stroke();
                    } else {
                        ctx.beginPath();
                        ctx.arc(x + pSize/2, y + pSize/2, pSize/2, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }
            }
        }
        return canvas.toBuffer();
    }

    async renderLeaderboard(topPlayers, users, emojis, strongestPlayerId) {
        const width = 800;
        const height = 700;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#1a1c23');
        grad.addColorStop(1, '#0f1015');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Arial';
        ctx.fillText('🏆 HALL OF LEGENDS', 50, 80);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '20px Arial';
        ctx.fillText('The strongest warriors of Hyperions', 50, 115);

        for (let i = 0; i < topPlayers.length; i++) {
            const player = topPlayers[i];
            const user = users.find(u => u.id === player.user_id);
            const y = 200 + i * 85;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            if (i === 0) ctx.fillStyle = 'rgba(255, 215, 0, 0.08)';
            if (player.user_id === strongestPlayerId) ctx.fillStyle = 'rgba(255, 0, 100, 0.1)';
            
            this.drawRoundedRect(ctx, 40, y - 55, width - 80, 75, 15);
            ctx.fill();

            ctx.fillStyle = i === 0 ? '#ffd700' : (i === 1 ? '#c0c0c0' : (i === 2 ? '#cd7f32' : '#ffffff'));
            ctx.font = 'bold 28px Arial';
            ctx.fillText(`#${i + 1}`, 65, y - 5);

            if (user && user.displayAvatarURL) {
                try {
                    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 128 }));
                    ctx.save();
                    ctx.beginPath(); ctx.arc(150, y - 15, 25, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(avatar, 125, y - 40, 50, 50);
                    ctx.restore();
                } catch (e) {
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.beginPath(); ctx.arc(150, y - 15, 25, 0, Math.PI * 2); ctx.fill();
                }
            }

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 22px Arial';
            let nameText = user ? user.username : 'Unknown Warrior';
            if (player.user_id === strongestPlayerId) {
                ctx.fillStyle = '#ff3e3e';
                nameText += ' [STRONGEST]';
            }
            ctx.fillText(nameText, 220, y - 15);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '16px Arial';
            const winRate = Math.round((player.wins / (player.wins + player.losses + player.draws || 1)) * 100);
            ctx.fillText(`WR: ${winRate}% | Streak: ${player.current_streak} (Max: ${player.highest_streak})`, 220, y + 10);

            ctx.fillStyle = i === 0 ? '#ffd700' : '#ffffff';
            ctx.font = 'bold 30px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(`${player.points} PTS`, width - 80, y - 5);
            ctx.textAlign = 'left';
        }

        return canvas.toBuffer();
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}

module.exports = new GameEngine();
