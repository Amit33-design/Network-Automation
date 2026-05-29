/**
 * Vercel serverless: POST /api/license/validate
 *
 * Body: { key: string, seats_requested?: number }
 *
 * Flow:
 *   1. Check Upstash Redis cache (avoids hammering Supabase on every page load)
 *   2. On miss: query Supabase, write result back to cache (TTL 1hr)
 *   3. Rate-limit brute-force attempts: 20 failed attempts / 15min per IP → 429
 *
 * Returns: { valid: bool, plan: string, seats: number, expires_at: string }
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const json = await r.json();
  return json.result ?? null;
}

async function redisSetEx(key, ttlSeconds, value) {
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?ex=${ttlSeconds}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    method: "GET",
  });
}

async function redisIncr(key, ttlSeconds) {
  const r = await fetch(`${REDIS_URL}/incr/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    method: "GET",
  });
  const json = await r.json();
  const count = json.result ?? 0;
  if (count === 1) {
    await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      method: "GET",
    });
  }
  return count;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const ip  = req.headers["x-forwarded-for"]?.split(",")[0] ?? "unknown";
  const { key, seats_requested = 1 } = req.body ?? {};

  if (!key || typeof key !== "string" || !/^NDA-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(key)) {
    return res.status(400).json({ valid: false, error: "Invalid key format" });
  }

  // Brute-force guard — track per IP
  const bruteKey   = `bruteforce:license:${ip}`;
  const bruteCount = await redisIncr(bruteKey, 900); // 15-min window
  if (bruteCount > 20) {
    return res.status(429).json({ valid: false, error: "Too many attempts" });
  }

  // Cache check
  const cacheKey    = `license:${key}`;
  const cachedValue = await redisGet(cacheKey);
  if (cachedValue) {
    const cached = JSON.parse(cachedValue);
    if (cached.valid && seats_requested <= cached.seats) {
      return res.status(200).json(cached);
    }
    if (!cached.valid) return res.status(200).json(cached);
  }

  // Supabase lookup
  const { data, error } = await supabase
    .from("license_keys")
    .select("plan, seats, expires_at, is_active")
    .eq("key", key)
    .single();

  if (error || !data) {
    const result = { valid: false, error: "License not found" };
    await redisSetEx(cacheKey, 300, JSON.stringify(result)); // cache negative 5min
    return res.status(200).json(result);
  }

  const expired = new Date(data.expires_at) < new Date();
  const valid   = data.is_active && !expired && seats_requested <= data.seats;

  const result = {
    valid,
    plan:       data.plan,
    seats:      data.seats,
    expires_at: data.expires_at,
    ...(!valid && { error: expired ? "License expired" : !data.is_active ? "License inactive" : "Seat limit exceeded" }),
  };

  await redisSetEx(cacheKey, valid ? 3600 : 300, JSON.stringify(result));
  return res.status(200).json(result);
}
