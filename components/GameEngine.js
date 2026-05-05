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
        const width = 900, height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Background
        ctx.fillStyle = '#060B11';
        ctx.fillRect(0, 0, width, height);

        // subtle background grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke(); }
        for (let i = 0; i < height; i += 20) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke(); }

        const cellSize = 60;
        const gridTotal = 5 * cellSize; 
        const startY = 120;
        const startX1 = 80;
        const startX2 = width - 80 - gridTotal;

        const drawRadar = (startX, attacks, enemyShips, isTurn, playerName, colorTheme) => {
            ctx.textAlign = 'center';
            ctx.font = 'bold 24px "Courier New", Courier, monospace';
            ctx.fillStyle = isTurn ? colorTheme : '#4a5568';
            ctx.shadowColor = isTurn ? colorTheme : 'transparent';
            ctx.shadowBlur = isTurn ? 15 : 0;
            ctx.fillText(`${playerName.toUpperCase()}'S RADAR`, startX + gridTotal / 2, 60);
            ctx.shadowBlur = 0;
            
            ctx.font = '14px "Courier New", Courier, monospace';
            ctx.fillStyle = '#4a5568';
            ctx.fillText(`UPLINK SECURE // TARGET ACQUIRED`, startX + gridTotal / 2, 85);

            const cx = startX + gridTotal / 2;
            const cy = startY + gridTotal / 2;
            
            const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, gridTotal / 1.5);
            bgGrad.addColorStop(0, 'rgba(0, 255, 128, 0.15)');
            bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(startX - 20, startY - 20, gridTotal + 40, gridTotal + 40);

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, gridTotal/1.4, -Math.PI/2, -Math.PI/4);
            ctx.closePath();
            const sweepGrad = ctx.createLinearGradient(cx, cy, cx + 100, cy - 100);
            sweepGrad.addColorStop(0, 'rgba(0, 255, 128, 0.3)');
            sweepGrad.addColorStop(1, 'rgba(0, 255, 128, 0)');
            ctx.fillStyle = sweepGrad;
            ctx.fill();

            ctx.strokeStyle = 'rgba(0, 255, 128, 0.2)';
            ctx.lineWidth = 1;
            for(let i=1; i<=4; i++) {
                ctx.beginPath();
                ctx.arc(cx, cy, i * (gridTotal/2.5) / 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            ctx.beginPath(); ctx.moveTo(cx, startY - 20); ctx.lineTo(cx, startY + gridTotal + 20); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(startX - 20, cy); ctx.lineTo(startX + gridTotal + 20, cy); ctx.stroke();

            ctx.strokeStyle = 'rgba(0, 255, 128, 0.4)';
            ctx.lineWidth = 2;
            
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    const x = startX + c * cellSize;
                    const y = startY + r * cellSize;
                    const cellId = `${r}_${c}`;
                    
                    ctx.strokeRect(x, y, cellSize, cellSize);
                    
                    if (attacks.includes(cellId)) {
                        const isHit = enemyShips.includes(cellId);
                        
                        if (isHit) {
                            ctx.fillStyle = 'rgba(255, 0, 85, 0.2)';
                            ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                            
                            ctx.strokeStyle = '#ff0055';
                            ctx.lineWidth = 3;
                            ctx.shadowColor = '#ff0055';
                            ctx.shadowBlur = 10;
                            
                            ctx.beginPath();
                            const p = 15;
                            ctx.moveTo(x + p, y + p); ctx.lineTo(x + cellSize - p, y + cellSize - p);
                            ctx.moveTo(x + cellSize - p, y + p); ctx.lineTo(x + p, y + cellSize - p);
                            ctx.stroke();
                            
                            ctx.shadowBlur = 0;
                        } else {
                            ctx.fillStyle = 'rgba(0, 240, 255, 0.1)';
                            ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                            
                            ctx.fillStyle = '#00f0ff';
                            ctx.shadowColor = '#00f0ff';
                            ctx.shadowBlur = 8;
                            ctx.beginPath();
                            ctx.arc(x + cellSize/2, y + cellSize/2, 6, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.shadowBlur = 0;
                        }
                    }
                }
            }
            
            ctx.fillStyle = 'rgba(0, 255, 128, 0.6)';
            ctx.font = '16px "Courier New", Courier, monospace';
            const letters = ['A', 'B', 'C', 'D', 'E'];
            for(let i=0; i<5; i++) {
                ctx.fillText(letters[i], startX + i * cellSize + cellSize/2, startY - 10);
                ctx.fillText((i+1).toString(), startX - 15, startY + i * cellSize + cellSize/2 + 5);
            }
            
            ctx.strokeStyle = colorTheme;
            ctx.lineWidth = 3;
            const cs = 15; 
            const off = 10;
            ctx.beginPath(); ctx.moveTo(startX - off, startY - off + cs); ctx.lineTo(startX - off, startY - off); ctx.lineTo(startX - off + cs, startY - off); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(startX + gridTotal + off - cs, startY - off); ctx.lineTo(startX + gridTotal + off, startY - off); ctx.lineTo(startX + gridTotal + off, startY - off + cs); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(startX - off, startY + gridTotal + off - cs); ctx.lineTo(startX - off, startY + gridTotal + off); ctx.lineTo(startX - off + cs, startY + gridTotal + off); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(startX + gridTotal + off - cs, startY + gridTotal + off); ctx.lineTo(startX + gridTotal + off, startY + gridTotal + off); ctx.lineTo(startX + gridTotal + off, startY + gridTotal + off - cs); ctx.stroke();

            // Tactical Data Readouts
            ctx.font = '9px "Courier New", Courier, monospace';
            ctx.fillStyle = 'rgba(0, 255, 128, 0.4)';
            ctx.textAlign = 'left';
            const dataLines = [
                `SEQ_ID: ${Math.random().toString(36).substring(7).toUpperCase()}`,
                `COORDS: ${Math.floor(Math.random()*90)}.${Math.floor(Math.random()*99)}'N`,
                `SONAR: ACTIVE`,
                `UPLINK: STABLE`
            ];
            dataLines.forEach((line, i) => {
                ctx.fillText(line, startX + gridTotal + 15, startY + i * 12);
            });
        };

        const turnX = gameState.turn === 'X' || gameState.winner;
        const turnO = gameState.turn === 'O' || gameState.winner;

        drawRadar(startX1, gameState.attacks.X, gameState.ships.O, turnX, gameState.players.X.username, '#00ffaa');
        drawRadar(startX2, gameState.attacks.O, gameState.ships.X, turnO, gameState.players.O.username, '#00ffaa');

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width/2, 50);
        ctx.lineTo(width/2, height - 50);
        ctx.stroke();

        return canvas.toBuffer('image/png');
    }

    async getUnoCardImage(card) {
        const baseUrl = 'https://raw.githubusercontent.com/celsiusnarhwal/uno/main/cards/';
        let filename = '';
        const colors = { red: 'R', blue: 'B', green: 'G', yellow: 'Y' };
        const values = { skip: 'S', reverse: 'R', draw2: 'A2' };

        if (card.color === 'black') {
            filename = card.value === 'wild' ? 'WC.png' : 'W4.png';
        } else {
            const colorPrefix = colors[card.color];
            const valueSuffix = values[card.value] || card.value;
            filename = `${colorPrefix}${valueSuffix}.png`;
        }

        const url = `${baseUrl}${filename}`;
        if (this.emojiCache.has(url)) return this.emojiCache.get(url);
        
        try {
            const img = await loadImage(url).catch(() => null);
            if (img) this.emojiCache.set(url, img);
            return img;
        } catch { return null; }
    }

    async renderUno(gs) {
        const width = 800, height = 800;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Premium Table Background
        const grad = ctx.createRadialGradient(width/2, height/2, 50, width/2, height/2, width/1.5);
        grad.addColorStop(0, '#1e3a8a'); grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);

        // Subgrid/Texture
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke(); }
        for (let i = 0; i < height; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke(); }

        // Center Table
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(width/2, height/2, 250, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 5;
        ctx.stroke();

        const topCard = gs.discard[gs.discard.length - 1];
        const cardImg = await this.getUnoCardImage(topCard);
        
        // Draw Top Card in Center
        if (cardImg) {
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 20;
            ctx.drawImage(cardImg, width/2 - 60, height/2 - 90, 120, 180);
            ctx.shadowBlur = 0;
        }

        // Draw Player Positions (Bottom, Left, Top, Right)
        const players = gs.playerOrder; // Array of pKeys (e.g., ['X', 'O', 'P3', 'P4'])
        const positions = [
            { x: width/2, y: height - 80, rot: 0 },    // Bottom (Self/Current)
            { x: 80, y: height/2, rot: Math.PI/2 },    // Left
            { x: width/2, y: 80, rot: Math.PI },       // Top
            { x: width - 80, y: height/2, rot: -Math.PI/2 } // Right
        ];

        ctx.textAlign = 'center';
        for (let i = 0; i < players.length; i++) {
            const pKey = players[i];
            const player = gs.players[pKey];
            const pos = positions[i];
            const isTurn = gs.turn === pKey;

            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(pos.rot);

            // Turn Indicator Glow
            if (isTurn) {
                ctx.shadowColor = '#00ffaa';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#00ffaa';
            } else {
                ctx.fillStyle = '#ffffff';
            }

            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(player.username.toUpperCase(), 0, 0);
            ctx.font = '16px sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.fillText(`${player.hand.length} CARDS`, 0, 25);

            // Draw card back visual
            ctx.fillStyle = '#ff3333';
            this.drawRoundedRect(ctx, -20, 40, 40, 60, 5);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.restore();
        }

        // Direction Indicator
        ctx.save();
        ctx.translate(width/2, height/2);
        ctx.rotate(gs.reverse ? -gs.moveCount * 0.2 : gs.moveCount * 0.2);
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 200, -0.2, 0.2);
        ctx.stroke();
        // arrow head
        ctx.restore();

        return canvas.toBuffer();
    }

    drawUnoCard(ctx, x, y, w, h, card) {
        // Obsolete, replaced by getUnoCardImage and direct drawing
    }
}

module.exports = new GameEngine();
