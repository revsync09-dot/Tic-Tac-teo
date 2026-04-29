const { createCanvas, loadImage } = require('canvas');

class GameEngine {
    constructor() {
        this.emojiCache = new Map();
    }

    async getEmojiImage(id) {
        if (!id) return null;
        if (this.emojiCache.has(id)) return this.emojiCache.get(id);
        try {
            const cleanId = id.replace(/[^\d]/g, '');
            if (cleanId.length < 10) return null;
            const img = await loadImage(`https://cdn.discordapp.com/emojis/${cleanId}.png`).catch(() => null);
            if (img) this.emojiCache.set(id, img);
            return img;
        } catch (e) { return null; }
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
            ctx.moveTo(i * (size / 3), 10); ctx.lineTo(i * (size / 3), size - 10);
            ctx.moveTo(10, i * (size / 3)); ctx.lineTo(size - 10, i * (size / 3));
        }
        ctx.stroke();

        const crownImg = await this.getEmojiImage(emojis.CROWN);
        const imgX = await this.getEmojiImage(emojis.X);
        const imgO = await this.getEmojiImage(emojis.O);

        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const cell = board[r][c];
                if (!cell) continue;
                const playerObj = players[cell];
                const img = cell === 'X' ? imgX : imgO;
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

    async renderC4Board(board, emojis, players = {}, strongestId = null) {
        const rows = 6, cols = 7;
        const cellSize = 80;
        const padding = 20;
        const width = cols * cellSize + padding * 2;
        const height = rows * cellSize + padding * 2;
        
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#0f1015';
        ctx.fillRect(0, 0, width, height);

        // Board Base
        ctx.fillStyle = '#1e3a8a';
        this.drawRoundedRect(ctx, padding - 10, padding - 10, cols * cellSize + 20, rows * cellSize + 20, 20);
        ctx.fill();

        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 10;
        
        const crownImg = await this.getEmojiImage(emojis.CROWN);
        const redImg = await this.getEmojiImage(emojis.C4_RED);
        const yellowImg = await this.getEmojiImage(emojis.C4_YELLOW);
        const emptyImg = await this.getEmojiImage(emojis.C4_EMPTY);
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = board[r][c];
                const x = padding + c * cellSize + cellSize / 2;
                const y = padding + r * cellSize + cellSize / 2;
                const radius = cellSize / 2 - 8;

                if (!cell) {
                    if (emptyImg) {
                        ctx.drawImage(emptyImg, x - radius, y - radius, radius * 2, radius * 2);
                    } else {
                        ctx.beginPath();
                        ctx.arc(x, y, radius, 0, Math.PI * 2);
                        ctx.fillStyle = '#0f1015';
                        ctx.fill();
                    }
                } else {
                    const img = cell === 'X' ? redImg : yellowImg;
                    if (img) {
                        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
                    } else {
                        ctx.beginPath();
                        ctx.arc(x, y, radius, 0, Math.PI * 2);
                        ctx.fillStyle = cell === 'X' ? '#ef4444' : '#facc15';
                        ctx.fill();
                    }
                    
                    const playerObj = players[cell];
                    if (playerObj && playerObj.id === strongestId && crownImg) {
                        ctx.drawImage(crownImg, x - 12, y - 12, 24, 24);
                    }
                }
            }
        }
        ctx.shadowBlur = 0;
        return canvas.toBuffer();
    }

    async renderRPS(moves, players, roundInfo, emojis = {}) {
        const width = 600, height = 300;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, '#0d0f16'); bg.addColorStop(1, '#1a1e2e');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('VS', width / 2, height / 2 + 15);
        
        const rockImg = await this.getEmojiImage(emojis.RPS_ROCK);
        const paperImg = await this.getEmojiImage(emojis.RPS_PAPER);
        const scissorsImg = await this.getEmojiImage(emojis.RPS_SCISSORS);
        const hiddenImg = await this.getEmojiImage(emojis.RPS_HIDDEN);
        const readyImg = await this.getEmojiImage(emojis.RPS_READY);

        const drawMove = (moveStr, x, y, color) => {
            const textMap = { 'rock': '🪨 ROCK', 'paper': '📄 PAPER', 'scissors': '✂️ SCISSORS', 'hidden': '❓ WAITING', 'ready': '✅ READY' };
            const imgMap = { 'rock': rockImg, 'paper': paperImg, 'scissors': scissorsImg, 'hidden': hiddenImg, 'ready': readyImg };
            
            const img = imgMap[moveStr];
            if (img) {
                ctx.drawImage(img, x - 25, y - 40, 50, 50);
                ctx.fillStyle = color;
                ctx.font = 'bold 20px sans-serif';
                ctx.fillText(textMap[moveStr].split(' ')[1], x, y + 30);
            } else {
                ctx.fillStyle = color;
                ctx.font = 'bold 36px sans-serif';
                ctx.fillText(textMap[moveStr] || '...', x, y);
            }
        };

        const stateX = moves.X ? (moves.O ? moves.X : 'ready') : 'hidden';
        const stateO = moves.O ? (moves.X ? moves.O : 'ready') : 'hidden';

        drawMove(stateX, width * 0.25, height / 2 + 10, '#ef4444');
        drawMove(stateO, width * 0.75, height / 2 + 10, '#3b82f6');
        
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.fillText(players.X.username, width * 0.25, height - 30);
        ctx.fillStyle = '#3b82f6';
        ctx.fillText(players.O.username, width * 0.75, height - 30);

        if (roundInfo) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText(roundInfo, width / 2, 40);
        }

        ctx.textAlign = 'left';
        return canvas.toBuffer();
    }

    async renderProfileCard(user, stats, rankTitle, globalRank) {
        const W = 700, H = 280;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#0d0f16'); bg.addColorStop(1, '#1a1e2e');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        const rankColors = { GOD: '#ff0055', LEGEND: '#a855f7', ELITE: '#3b82f6', ROOKIE: '#22c55e', UNRANKED: '#6b7280' };
        const glow = rankColors[rankTitle] || '#6b7280';
        ctx.shadowColor = glow; ctx.shadowBlur = 30; ctx.strokeStyle = glow; ctx.lineWidth = 2;
        this.drawRoundedRect(ctx, 2, 2, W - 4, H - 4, 18); ctx.stroke(); ctx.shadowBlur = 0;

        ctx.save();
        ctx.beginPath(); ctx.arc(100, H / 2, 70, 0, Math.PI * 2); ctx.clip();
        try {
            const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
            ctx.drawImage(avatar, 30, H / 2 - 70, 140, 140);
        } catch { ctx.fillStyle = '#2d2f3b'; ctx.fill(); }
        ctx.restore();

        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(user.username, 195, 70);
        ctx.fillStyle = glow; ctx.font = 'bold 20px sans-serif'; ctx.fillText(`[ ${rankTitle} ]  #${globalRank} GLOBAL`, 195, 100);

        const statItems = [
            { label: 'WINS', value: stats.wins, color: '#22c55e' },
            { label: 'LOSSES', value: stats.losses, color: '#ef4444' },
            { label: 'DRAWS', value: stats.draws, color: '#94a3b8' },
            { label: 'POINTS', value: stats.points, color: '#ffd700' },
        ];
        statItems.forEach((item, i) => {
            const x = 195 + i * 125, y = 160;
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; this.drawRoundedRect(ctx, x, y, 110, 70, 10); ctx.fill();
            ctx.fillStyle = item.color; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(item.value, x + 55, y + 38);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.fillText(item.label, x + 55, y + 60); ctx.textAlign = 'left';
        });

        const wr = Math.round((stats.wins / (stats.wins + stats.losses + stats.draws || 1)) * 100);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; this.drawRoundedRect(ctx, 195, 245, W - 225, 20, 10); ctx.fill();
        ctx.fillStyle = glow; this.drawRoundedRect(ctx, 195, 245, Math.max(20, (W - 225) * wr / 100), 20, 10); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`WIN RATE: ${wr}%  |  STREAK: ${stats.current_streak}  |  BEST: ${stats.highest_streak}`, 198, 260);
        return canvas.toBuffer();
    }

    async renderLeaderboard(topPlayers, users, emojis, strongestPlayerId, customTitle = 'HALL OF LEGENDS') {
        const width = 800, height = 1500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1c23'; ctx.fillRect(0, 0, width, height);

        const winEmojiImg = await this.getEmojiImage(emojis.WIN);
        if (winEmojiImg) ctx.drawImage(winEmojiImg, 50, 35, 45, 45);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(customTitle, winEmojiImg ? 110 : 50, 70);

        for (let i = 0; i < topPlayers.length; i++) {
            const player = topPlayers[i], user = users.find(u => u.id === player.user_id), y = 195 + i * 85;
            ctx.fillStyle = 'rgba(255,255,255,0.04)'; this.drawRoundedRect(ctx, 40, y - 55, width - 80, 75, 15); ctx.fill();
            ctx.fillStyle = i === 0 ? '#ffd700' : '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(`#${i + 1}`, 65, y - 8);
            if (user) {
                try {
                    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 64 }));
                    ctx.save(); ctx.beginPath(); ctx.arc(155, y - 18, 25, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, 130, y - 43, 50, 50); ctx.restore();
                } catch { }
            }
            ctx.fillStyle = '#ffffff'; ctx.font = `bold 22px sans-serif`; ctx.fillText(user ? user.username : 'Unknown', 215, y - 20);
            ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '15px sans-serif';
            ctx.fillText(`W:${player.wins} L:${player.losses} | Streak:${player.current_streak}`, 215, y + 8);
            ctx.textAlign = 'right'; ctx.fillText(`${player.points} PTS`, width - 65, y - 8); ctx.textAlign = 'left';
        }
        return canvas.toBuffer();
    }

    drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    async renderBS(gameState, emojis) {
        const width = 500, height = 300;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#2b2d31';
        ctx.fillRect(0, 0, width, height);
        
        const cellSize = 40;
        const gridSpacing = 60;
        const startX1 = 20;
        const startX2 = 20 + 5 * cellSize + gridSpacing;
        const startY = 60;

        // Draw Player Headers
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`Player 1 Radar`, startX1 + (5 * cellSize) / 2, 35);
        ctx.fillText(`Player 2 Radar`, startX2 + (5 * cellSize) / 2, 35);

        const waterImg = await this.getEmojiImage(emojis.BS_WATER) || null;
        const hitImg = await this.getEmojiImage(emojis.BS_HIT) || null;
        const missImg = await this.getEmojiImage(emojis.BS_MISS) || null;

        const drawGrid = (startX, attacks, enemyShips) => {
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    const x = startX + c * cellSize;
                    const y = startY + r * cellSize;
                    const cellId = `${r}_${c}`;
                    
                    ctx.fillStyle = '#1e1f22';
                    ctx.fillRect(x, y, cellSize - 2, cellSize - 2);
                    
                    if (waterImg) ctx.drawImage(waterImg, x + 2, y + 2, cellSize - 6, cellSize - 6);
                    
                    if (attacks.includes(cellId)) {
                        const isHit = enemyShips.includes(cellId);
                        const img = isHit ? hitImg : missImg;
                        if (img) ctx.drawImage(img, x + 2, y + 2, cellSize - 6, cellSize - 6);
                        else {
                            ctx.font = '20px Arial';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(isHit ? '💥' : '🌊', x + cellSize/2, y + cellSize/2);
                        }
                    }
                }
            }
        };

        // P1's Radar (Attacks made by X, enemy is O)
        drawGrid(startX1, gameState.attacks.X, gameState.ships.O);
        
        // P2's Radar (Attacks made by O, enemy is X)
        drawGrid(startX2, gameState.attacks.O, gameState.ships.X);

        return canvas.toBuffer('image/png');
    }
}

module.exports = new GameEngine();
