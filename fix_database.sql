-- Run this in your Supabase SQL Editor to FIX the missing columns:

ALTER TABLE rankings 
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS highest_streak INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_match TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Also ensure the index is updated
CREATE INDEX IF NOT EXISTS idx_rankings_streak ON rankings (highest_streak DESC);
