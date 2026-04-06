# Cowork Instructions: Supabase Schema Setup & Player Seeding

## Task 1: Run the Database Schema

1. Open Chrome and navigate to: https://supabase.com/dashboard/project/bdagqpjybwqphbjvydsh/sql/new
2. Log in if prompted
3. Copy the ENTIRE contents of the file `supabase/schema.sql` from this project directory (`/Users/donaldmalouf/Desktop/golf-majors-pool/supabase/schema.sql`)
4. Paste it into the SQL editor
5. Click the **Run** button (or press Cmd+Enter)
6. Verify you see success messages — no errors. You should see confirmations for:
   - 6 tables created (users, tournaments, players, rosters, tournament_players, scores)
   - Indexes created
   - RLS policies created
   - 4 tournaments seeded (Masters, PGA Championship, U.S. Open, Open Championship)

## Task 2: Seed the Players

After the schema is created successfully:

1. Open Terminal
2. Run: `cd /Users/donaldmalouf/Desktop/golf-majors-pool && npm run seed`
3. You should see output showing:
   - 91 players fetched from Data Golf API
   - Price distribution ($1-$30)
   - Top 15 players with prices
   - "Successfully seeded 91 players!"

## Task 3: Verify in Supabase

1. Go to https://supabase.com/dashboard/project/bdagqpjybwqphbjvydsh/editor
2. Click on the `players` table
3. Verify you see ~91 rows with names and prices
4. Click on the `tournaments` table
5. Verify you see 4 rows (Masters, PGA Championship, U.S. Open, Open Championship)

## If Something Goes Wrong

- If schema SQL fails with "already exists" errors: The tables were already created. You can drop them first by running `DROP TABLE IF EXISTS scores, tournament_players, rosters, players, tournaments, users CASCADE;` then re-run the schema.
- If `npm run seed` fails with a Supabase error about the `players` table not existing: Make sure Task 1 completed successfully first.
- If `npm run seed` fails with a Data Golf API error: Check that the API key in `.env` is correct.
