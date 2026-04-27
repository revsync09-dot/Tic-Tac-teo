-- Run this in your Supabase SQL Editor to upgrade your ranking system:

CREATE TABLE IF NOT EXISTS rankings (
    user_id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    highest_streak INTEGER DEFAULT 0,
    last_match TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for leaderboard
CREATE INDEX IF NOT EXISTS idx_rankings_points ON rankings (points DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_streak ON rankings (highest_streak DESC);

-- Policy
ALTER TABLE rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All" ON rankings FOR ALL USING (true);
