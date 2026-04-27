const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

let isDbHealthy = true;

/**
 * Updates a user's stats in the database.
 * @param {string} userId Discord User ID
 * @param {'win' | 'loss' | 'draw'} result 
 * @returns {Promise<any>} The updated stats
 */
async function updateStats(userId, result) {
    const start = Date.now();
    try {
        const { data: current, error: fetchError } = await supabase
            .from('rankings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        const stats = {
            user_id: userId,
            wins: (current?.wins || 0),
            losses: (current?.losses || 0),
            draws: (current?.draws || 0),
            points: (current?.points || 0),
            current_streak: (current?.current_streak || 0),
            highest_streak: (current?.highest_streak || 0),
            last_match: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (result === 'win') {
            stats.wins += 1;
            stats.points += 3;
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
            }
        }

        const { data, error: upsertError } = await supabase
            .from('rankings')
            .upsert(stats, { onConflict: 'user_id' })
            .select()
            .single();

        if (upsertError) throw upsertError;
        
        console.log(`[DB] Saved ${result.toUpperCase()} for ${userId} (${Date.now() - start}ms)`);
        isDbHealthy = true;
        return data;
    } catch (err) {
        isDbHealthy = false;
        console.error(`[DB Error] Update failed for ${userId}:`, err.message);
        return null;
    }
}

async function getLeaderboard() {
    try {
        const { data, error } = await supabase
            .from('rankings')
            .select('*')
            .order('points', { ascending: false })
            .limit(10);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[DB Error] Fetch failed:', err.message);
        return [];
    }
}

async function getStrongestPlayer() {
    try {
        const { data, error } = await supabase
            .from('rankings')
            .select('*')
            .order('highest_streak', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data;
    } catch (err) {
        return null;
    }
}

async function getTotalGames() {
    try {
        const { count, error } = await supabase
            .from('rankings')
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        return count || 0;
    } catch (e) {
        return 0;
    }
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
    } catch (e) {
        return 'N/A';
    }
}

module.exports = { 
    updateStats, 
    getLeaderboard, 
    getStrongestPlayer, 
    getTotalGames, 
    getUserRank,
    checkHealth: () => isDbHealthy
};
