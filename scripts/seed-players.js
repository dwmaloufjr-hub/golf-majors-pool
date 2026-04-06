/**
 * Player Pricing Script
 * Fetches Masters 2026 pre-tournament predictions from Data Golf,
 * converts American odds to implied probability, then to dollar prices ($1-$30),
 * and seeds the players table in Supabase.
 *
 * Usage: node scripts/seed-players.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DATAGOLF_API_KEY = process.env.DATAGOLF_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATAGOLF_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing environment variables. Check .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Convert American odds string to implied win probability
function oddsToProb(oddsStr) {
  const odds = parseInt(oddsStr, 10);
  if (isNaN(odds)) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Price tiers based on win probability ranking
function calculatePrice(rank) {
  if (rank <= 2) return 30;
  if (rank <= 4) return 25;
  if (rank <= 6) return 22;
  if (rank <= 8) return 19;
  if (rank <= 10) return 17;
  if (rank <= 13) return 15;
  if (rank <= 16) return 13;
  if (rank <= 20) return 11;
  if (rank <= 25) return 9;
  if (rank <= 30) return 7;
  if (rank <= 40) return 5;
  if (rank <= 50) return 4;
  if (rank <= 60) return 3;
  if (rank <= 75) return 2;
  return 1;
}

async function seedPlayers() {
  try {
    const url = `https://feeds.datagolf.com/preds/pre-tournament?tour=pga&odds_format=american&file_format=json&key=${DATAGOLF_API_KEY}`;
    console.log('Fetching Masters pre-tournament predictions from Data Golf...');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Data Golf API error: ${res.status} ${res.statusText}`);

    const data = await res.json();
    console.log(`Event: ${data.event_name}`);
    console.log(`Last updated: ${data.last_updated}`);

    // Use baseline_history_fit (more accurate) or fall back to baseline
    const playerList = data.baseline_history_fit || data.baseline;
    if (!playerList?.length) throw new Error('No player data found');

    // Calculate implied probability from win odds and sort
    playerList.forEach((p) => {
      p._winProb = oddsToProb(p.win);
    });
    playerList.sort((a, b) => b._winProb - a._winProb);

    console.log(`\nFound ${playerList.length} players`);

    // Build player records
    const playerRecords = playerList.map((p, i) => ({
      dg_id: p.dg_id,
      name: p.player_name,
      price: calculatePrice(i + 1),
    }));

    // Log price distribution
    const dist = {};
    playerRecords.forEach((p) => { dist[p.price] = (dist[p.price] || 0) + 1; });
    console.log('\nPrice distribution:');
    Object.entries(dist)
      .sort(([a], [b]) => Number(b) - Number(a))
      .forEach(([price, count]) => console.log(`  $${price}: ${count} players`));

    // Preview top 15
    console.log('\nTop 15 players:');
    playerList.slice(0, 15).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.player_name} (${p.win}) — $${playerRecords[i].price} — ${(p._winProb * 100).toFixed(1)}% implied`);
    });

    // Upsert into Supabase
    console.log('\nSeeding players into Supabase...');
    const { data: seeded, error } = await supabase
      .from('players')
      .upsert(playerRecords, { onConflict: 'dg_id' })
      .select();

    if (error) throw new Error(`Supabase error: ${error.message}`);

    console.log(`\nSuccessfully seeded ${seeded.length} players!`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

seedPlayers();
