/**
 * Vercel serverless: POST /api/designs/similar
 *
 * Given an intent object, returns top-3 most similar saved designs from Pinecone.
 * Used at design-start to surface "Start from a similar design" cards.
 *
 * Body: { intent, topology_params?, use_case?, vendor? }
 * Returns: [{ id, design_name, use_case, vendor, intent_summary, score, saved_at }]
 */

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { getAuth } from "@clerk/nextjs/server";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INDEX = pinecone.index(process.env.PINECONE_INDEX ?? "netdesign-designs");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Require auth — only logged-in users see similar designs
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { intent, topology_params, use_case, vendor } = req.body ?? {};

  const parts = [
    use_case       && `use_case: ${use_case}`,
    vendor         && `vendor: ${vendor}`,
    intent         && `intent: ${JSON.stringify(intent)}`,
    topology_params && `topology: ${JSON.stringify(topology_params)}`,
  ].filter(Boolean);

  if (!parts.length) return res.status(400).json({ error: "Provide at least one of: intent, use_case, vendor" });

  try {
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: parts.join(" | "),
    });
    const vector = embeddingRes.data[0].embedding;

    const result = await INDEX.namespace("designs").query({
      vector,
      topK:            3,
      includeMetadata: true,
    });

    const matches = (result.matches ?? [])
      .filter(m => m.score > 0.75) // only surface genuinely similar results
      .map(m => ({
        id:             m.id,
        design_name:    m.metadata.design_name,
        use_case:       m.metadata.use_case,
        vendor:         m.metadata.vendor,
        intent_summary: m.metadata.intent_summary,
        score:          Math.round(m.score * 100) / 100,
        saved_at:       m.metadata.saved_at,
      }));

    res.status(200).json({ matches });
  } catch (err) {
    console.error("Pinecone similarity query failed:", err.message);
    res.status(500).json({ error: "Similarity search unavailable" });
  }
}
