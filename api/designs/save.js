/**
 * Vercel serverless: POST /api/designs/save
 *
 * Saves a design to Supabase and asynchronously embeds it in Pinecone so future
 * users can surface similar past designs ("Start from a similar design").
 *
 * Body: { user_id, design_name, intent, topology_params, use_case, vendor, config_bundle? }
 *
 * Embedding model: OpenAI text-embedding-3-small (~$0.000002/query)
 * Pinecone namespace: "designs"
 */

import { createClient } from "@supabase/supabase-js";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { clerkClient, getAuth } from "@clerk/nextjs/server";

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const pinecone  = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INDEX = pinecone.index(process.env.PINECONE_INDEX ?? "netdesign-designs");

function buildEmbedText(intent, topology_params, use_case, vendor) {
  const parts = [
    use_case && `use_case: ${use_case}`,
    vendor   && `vendor: ${vendor}`,
    intent   && `intent: ${JSON.stringify(intent)}`,
    topology_params && `topology: ${JSON.stringify(topology_params)}`,
  ].filter(Boolean);
  return parts.join(" | ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Clerk auth — require signed-in user
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { design_name, intent, topology_params, use_case, vendor, config_bundle } = req.body ?? {};

  if (!design_name) return res.status(400).json({ error: "design_name required" });

  // 1. Save to Supabase
  const { data: savedDesign, error: dbErr } = await supabase
    .from("designs")
    .insert({
      owner_id:        userId,
      name:            design_name,
      intent:          intent ?? {},
      topology_params: topology_params ?? {},
      use_case:        use_case ?? "unknown",
      vendor:          vendor ?? "multi",
      config_bundle:   config_bundle ?? null,
    })
    .select()
    .single();

  if (dbErr) {
    console.error("Supabase insert error:", dbErr);
    return res.status(500).json({ error: "Failed to save design" });
  }

  // 2. Embed + upsert to Pinecone asynchronously (don't block the response)
  res.status(200).json({ id: savedDesign.id, saved: true });

  try {
    const embedText = buildEmbedText(intent, topology_params, use_case, vendor);
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: embedText,
    });
    const vector = embeddingRes.data[0].embedding;

    await INDEX.namespace("designs").upsert([{
      id:       savedDesign.id,
      values:   vector,
      metadata: {
        design_name,
        use_case:  use_case ?? "unknown",
        vendor:    vendor   ?? "multi",
        owner_id:  userId,
        saved_at:  savedDesign.created_at,
        intent_summary: typeof intent === "object"
          ? Object.entries(intent).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(", ")
          : String(intent).slice(0, 200),
      },
    }]);
  } catch (embedErr) {
    // Non-fatal: the design is saved; Pinecone embed failure just means no similarity for this one
    console.error("Pinecone embed failed for design", savedDesign.id, embedErr.message);
  }
}
