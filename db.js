const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    transport: ws,
  },
});

let isDbHealthy = true;

const RANK_THRESHOLDS = [
    { min: 100, title: 'GOD' },
    { min: 50,  title: 'LEGEND' },
    { min: 20,  title: 'ELITE' },
    { min: 0,   title: 'ROOKIE' }
];

const STREAK_MILESTONES = [3, 5, 10, 15, 20, 30, 50];

function getRankTitle(points) {
    for (const r of RANK_THRESHOLDS) {
        if (points >= r.min) return r.title;
    }
    return 'UNRANKED';
}

/**
 * Returns { data, rankUp: bool, newRank, milestoneStreak }
 */
async function updateStats(userId, result) {
    const start = Date.now();
    try {
        const { data: current } = await supabase
            .from('rankings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        const oldRank = getRankTitle(current?.points || 0);
        const now = new Date();
        const currentWeek = getISOWeek(now);
        const oldMatchWeek = current?.last_match_week || 0;

        const stats = {
            user_id: userId,
            wins: current?.wins || 0,
            losses: current?.losses || 0,
            draws: current?.draws || 0,
            points: current?.points || 0,
            weekly_points: (currentWeek !== oldMatchWeek) ? 0 : (current?.weekly_points || 0),
            last_match_week: currentWeek,
            current_streak: current?.current_streak || 0,
            highest_streak: current?.highest_streak || 0,
            last_match: now.toISOString(),
            updated_at: now.toISOString()
        };

        if (result === 'win') {
            stats.wins += 1;
            stats.points += 3;
            stats.weekly_points += 3;
            stats.current_streak += 1;
            if (stats.current_streak > stats.highest_streak) {
                stats.highest_streak = stats.current_streak;
            }
        } else {
            stats.current_streak = 0;
            if (result === 'loss') stats.losses += 1;
            else if (result === 'draw') { 
                stats.draws += 1; 
                stats.points += 1; 
                stats.weekly_points += 1;
            }
        }

        const { data, error } = await supabase
            .from('rankings')
            .upsert(stats, { onConflict: 'user_id' })
            .select()
            .single();

        if (error) throw error;

        const newRank = getRankTitle(data.points);
        const rankUp = (oldRank !== newRank) && result === 'win';
        const milestoneStreak = STREAK_MILESTONES.includes(data.current_streak) ? data.current_streak : null;

        console.log(`[DB] ${result.toUpperCase()} for ${userId} → ${data.points}pts, rank: ${newRank} (${Date.now()-start}ms)`);
        isDbHealthy = true;
        return { data, rankUp, newRank, milestoneStreak };
    } catch (err) {
        isDbHealthy = false;
        console.error(`[DB Error] ${userId}:`, err.message);
        return { data: null, rankUp: false, newRank: null, milestoneStreak: null };
    }
}

async function getUserStats(userId) {
    try {
        const { data, error } = await supabase
            .from('rankings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return data;
    } catch (e) {
        return null;
    }
}

async function getLeaderboard(type = 'global') {
    try {
        const column = type === 'weekly' ? 'weekly_points' : 'points';
        const { data, error } = await supabase
            .from('rankings')
            .select('*')
            .order(column, { ascending: false })
            .limit(15);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[DB] Leaderboard fetch failed:', err.message);
        return [];
    }
}

function getISOWeek(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

async function getStrongestPlayer() {
    try {
        const { data, error } = await supabase
            .from('rankings')
            .select('*')
            .order('points', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data;
    } catch { return null; }
}

async function getTotalGames() {
    try {
        const { count, error } = await supabase
            .from('rankings')
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        return count || 0;
    } catch { return 0; }
}

async function getUserRank(userId) {
    try {
        const { data } = await supabase
            .from('rankings')
            .select('points')
            .eq('user_id', userId)
            .maybeSingle();
        if (!data) return 'N/A';
        const { count } = await supabase
            .from('rankings')
            .select('*', { count: 'exact', head: true })
            .gt('points', data.points);
        return (count || 0) + 1;
    } catch { return 'N/A'; }
}

module.exports = { 
    updateStats, getUserStats, getLeaderboard, getStrongestPlayer, 
    getTotalGames, getUserRank, getRankTitle,
    getWeeklyLeaderboard: () => getLeaderboard('weekly'),
    checkHealth: () => isDbHealthy
};
