/*
 * Land measurement: reads an area as written ("1 कट्ठा 4 धुर", "900 sq. ft",
 * "22 डि०") and converts between units.
 *
 * Conversions (Bihar, as used by the family):
 *   1 Dhur  = 68.0625 sq. ft     (shown as 68.06)
 *   1 Katha = 20 Dhur  = 1,361.25 sq. ft
 *   1 Bigha = 20 Katha = 27,225 sq. ft = 0.625 Acre
 *   1 Acre  = 32 Katha = 1.6 Bigha = 43,560 sq. ft
 *   1 Decimal (डिसमिल) = 1/100 Acre = 435.6 sq. ft
 */
(function (root) {
  const SQFT = {
    dhur: 68.0625,
    katha: 1361.25,
    bigha: 27225,
    acre: 43560,
    decimal: 435.6,
    sqft: 1,
    sqm: 10.7639104,
    sqyd: 9,
  };
  const LABEL = {
    dhur: "Dhur (धुर)", katha: "Katha (कट्ठा)", bigha: "Bigha (बीघा)", acre: "Acre (एकड़)",
    decimal: "Decimal (डिसमिल)", sqft: "sq. ft", sqm: "sq. m", sqyd: "sq. yard / Gaj (गज)",
  };
  // Every spelling we accept for each unit (English, Hindi, abbreviations).
  const UNIT_WORDS = [
    ["bigha", /^(bigha|bigaha|बीघा|बिगहा|बीघ|बिघा)/i],
    ["katha", /^(kattha|katha|kattah|कट्ठा|कठ्ठा|कट्टा|कठा|कट्ठ)/i],
    ["dhur", /^(dhur|dhoor|धुर|धूर)/i],
    ["decimal", /^(decimal|dismil|dismal|डिसमिल|डेसीमल|dec\b)/i],
    ["acre", /^(acres?|एकड़|एकड)/i],
    ["sqft", /^(sq\.?\s*(ft|feet|foot)|square\s*(ft|feet|foot)|sqft|वर्ग\s*फ(ु|ी)ट)/i],
    ["sqm", /^(sq\.?\s*m(tr|eter|etre)?s?\b|square\s*met(er|re)s?|sqm\b|वर्ग\s*मीटर)/i],
    ["sqyd", /^(sq\.?\s*(yd|yard)s?|square\s*yards?|gaj|गज)/i],
  ];

  function toAscii(text) {
    return String(text)
      .replace(/डि[०o.]|डी[०o.]/g, " decimal ")          // "22 डि०" — the ० here is an abbreviation mark
      .replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)))
      .replace(/,(?=\d{3}\b)/g, "");                    // 1,361 → 1361
  }

  // One measurement such as "1 कट्ठा 4 धुर" → sq. ft, or an error.
  function parseOne(text) {
    const s = text.trim();
    if (!s) return null;
    const re = /(\d+(?:\.\d+)?)\s*([^\d]*)/g;
    let m, sqft = 0, found = false;
    while ((m = re.exec(s))) {
      const n = parseFloat(m[1]);
      const unitText = m[2].replace(/^[\s\-–:]+/, "").trim();
      const unit = UNIT_WORDS.find(([, rx]) => rx.test(unitText));
      if (!unit) return { error: `unknown unit “${unitText || "(none)"}” after ${m[1]}` };
      sqft += n * SQFT[unit[0]];
      found = true;
    }
    return found ? { sqft } : { error: "no number found" };
  }

  /*
   * Whole area field. Text in brackets only repeats the unit in English, so it
   * is ignored. Several measurements separated by "," "/" or ";" are treated as
   * alternatives for the same land: the first is used, and if the others do not
   * agree the result says so.
   */
  function parseArea(text) {
    const raw = String(text || "").trim();
    if (!raw) return { status: "missing" };
    const cleaned = toAscii(raw).replace(/\([^)]*\)/g, " ");
    const parts = cleaned.split(/[,;/]|\bor\b|या/).map((p) => p.trim()).filter(Boolean);
    const results = parts.map(parseOne).filter(Boolean);
    const bad = results.find((r) => r.error);
    if (bad || !results.length) return { status: "unreadable", reason: bad ? bad.error : "no measurement" };
    const sqft = results[0].sqft;
    const disagree = results.slice(1).find((r) => Math.abs(r.sqft - sqft) > sqft * 0.02);
    return disagree
      ? { status: "conflict", sqft, other: disagree.sqft }
      : { status: "ok", sqft };
  }

  function round(n, d = 2) { const f = 10 ** d; return Math.round(n * f) / f; }

  // sq. ft → "1 बीघा 3 कट्ठा 4.5 धुर" style breakdown
  function toBighaKathaDhur(sqft) {
    let dhur = round(sqft / SQFT.dhur, 2);
    const bigha = Math.floor(dhur / 400); dhur = round(dhur - bigha * 400, 2);
    const katha = Math.floor(dhur / 20);  dhur = round(dhur - katha * 20, 2);
    return { bigha, katha, dhur };
  }
  function formatBKD(sqft) {
    const { bigha, katha, dhur } = toBighaKathaDhur(sqft);
    const out = [];
    if (bigha) out.push(`${bigha} Bigha`);
    if (katha) out.push(`${katha} Katha`);
    if (dhur || !out.length) out.push(`${dhur} Dhur`);
    return out.join(" ");
  }
  function convert(value, unit) {
    const sqft = value * SQFT[unit];
    return Object.fromEntries(Object.keys(SQFT).map((u) => [u, sqft / SQFT[u]]));
  }

  const api = { SQFT, LABEL, parseArea, toBighaKathaDhur, formatBKD, convert, round };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LandArea = api;
})(typeof window !== "undefined" ? window : globalThis);
