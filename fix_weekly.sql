-- Add weekly points tracking columns to rankings
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS weekly_points INTEGER DEFAULT 0;
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS last_match_week INTEGER DEFAULT 0;

-- Optional: Reset everyone for the start of the system
UPDATE rankings SET weekly_points = 0, last_match_week = EXTRACT(WEEK FROM NOW());
