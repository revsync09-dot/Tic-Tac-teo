-- Run this in your Supabase SQL Editor to FIX the RLS policy error:

-- OPTION 1: Disable RLS (Easiest and most reliable for a private bot)
ALTER TABLE rankings DISABLE ROW LEVEL SECURITY;

-- OPTION 2: If you want to keep RLS, use this policy instead:
-- DROP POLICY IF EXISTS "Allow All" ON rankings;
-- CREATE POLICY "Allow All" ON rankings FOR ALL USING (true) WITH CHECK (true);
