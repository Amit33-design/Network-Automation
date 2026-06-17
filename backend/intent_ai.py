"""
NetDesign AI — Claude-powered Intent Parser (G-A1)
=====================================================
Extracts structured Step 1 wizard fields (use case, scale, redundancy,
compliance, org details, vendor preferences, ...) from a free-text network
design description using the Anthropic Messages API with a constrained
JSON-schema output.

Falls back to the keyword-based `nl_parser.parse_intent()` heuristics when
ANTHROPIC_API_KEY is not configured, or when the API call fails for any
reason — callers always get a usable result.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("netdesign.intent_ai")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")

AI_AVAILABLE = bool(ANTHROPIC_API_KEY)
if not AI_AVAILABLE:
    log.info("ANTHROPIC_API_KEY not set — intent parsing uses heuristic fallback only")


# ── Value sets — mirror frontend/src/types/index.ts enums ───────────────────
USE_CASES   = ["campus", "dc", "gpu", "wan", "multisite", "multicloud", "aviatrix"]
APP_TYPES   = ["voice", "video", "storage", "hpc", "internet"]
SCALES      = ["small", "medium", "large"]
REDUNDANCY  = ["single", "dual"]
COMPLIANCE  = ["QoS", "PCI", "HIPAA", "SOC2", "FedRAMP", "NIST_CSF", "ISO27001"]
ORG_SIZES   = ["", "startup", "smb", "midmarket", "enterprise", "hyperscale"]
BUDGET_TIERS = ["", "smb", "mid", "enterprise", "hyperscale"]
VENDORS     = ["Cisco", "Arista", "Juniper", "NVIDIA", "Dell EMC", "HPE Aruba",
               "Fortinet", "Palo Alto", "Extreme Networks"]
INDUSTRIES  = ["", "Financial", "Healthcare", "Education", "Technology",
               "Manufacturing", "Retail", "Government", "Media/Telecom",
               "Energy", "Other"]

# ── Structured output schema for client.messages.create(output_config=...) ──
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "use_case":        {"type": "string", "enum": USE_CASES},
        "app_types":       {"type": "array", "items": {"type": "string", "enum": APP_TYPES}},
        "scale":           {"type": "string", "enum": SCALES},
        "redundancy":      {"type": "string", "enum": REDUNDANCY},
        "compliance":      {"type": "array", "items": {"type": "string", "enum": COMPLIANCE}},
        "org_name":        {"type": "string"},
        "org_size":        {"type": "string", "enum": ORG_SIZES},
        "budget_tier":     {"type": "string", "enum": BUDGET_TIERS},
        "vendor_prefs":    {"type": "array", "items": {"type": "string", "enum": VENDORS}},
        "industry":        {"type": "string", "enum": INDUSTRIES},
        "primary_contact": {"type": "string"},
        "confidence":      {"type": "number"},
        "notes":           {"type": "string"},
    },
    "required": [
        "use_case", "app_types", "scale", "redundancy", "compliance",
        "org_name", "org_size", "budget_tier", "vendor_prefs", "industry",
        "primary_contact", "confidence", "notes",
    ],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You are a network design intake assistant for NetDesign AI. Read the "
    "user's free-text description of their network and extract structured "
    "fields for the Step 1 project intake form.\n\n"
    "- `use_case` and `scale` are required — make your best inference even "
    "if not stated explicitly, and reflect uncertainty in `confidence`.\n"
    "- `redundancy`: 'dual' for any HA/redundant/resilient design, 'single' "
    "only if the text explicitly calls for a single, non-redundant design.\n"
    "- Leave `org_name`, `primary_contact`, `org_size`, `budget_tier`, "
    "`industry`, `vendor_prefs`, `app_types`, and `compliance` empty "
    "(empty string or empty array) when not mentioned — do not invent "
    "values that aren't supported by the text.\n"
    "- `confidence` is your overall 0-1 confidence in `use_case`.\n"
    "- `notes` is a short (<200 char) explanation of anything ambiguous, "
    "assumed, or worth the user's attention. Empty string if nothing notable."
)


def parse_intent_ai(description: str) -> dict[str, Any] | None:
    """
    Extract structured Step 1 fields from free text using the Claude API.

    Returns the parsed dict (matching RESPONSE_SCHEMA) on success, or None
    if AI parsing is unavailable / the call failed — callers should fall back
    to `heuristic_fallback()`.
    """
    if not AI_AVAILABLE:
        return None

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": description}],
            output_config={"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        )
    except anthropic.AuthenticationError:
        log.error("Anthropic API authentication failed — check ANTHROPIC_API_KEY")
        return None
    except anthropic.PermissionDeniedError:
        log.error("Anthropic API key lacks required permissions")
        return None
    except anthropic.NotFoundError:
        log.error("Anthropic API: invalid model '%s'", ANTHROPIC_MODEL)
        return None
    except anthropic.RateLimitError as exc:
        log.warning("Anthropic API rate limited: %s", exc)
        return None
    except anthropic.APIConnectionError as exc:
        log.warning("Anthropic API connection error: %s", exc)
        return None
    except anthropic.APIStatusError as exc:
        log.error("Anthropic API error (status %s): %s", exc.status_code, exc.message)
        return None

    try:
        text = next(b.text for b in response.content if b.type == "text")
        return json.loads(text)
    except (StopIteration, ValueError) as exc:
        log.error("Failed to parse Claude intent response as JSON: %s", exc)
        return None


def heuristic_fallback(description: str) -> dict[str, Any]:
    """
    Map nl_parser.parse_intent()'s keyword-based extraction onto the same
    shape as RESPONSE_SCHEMA, for use when the Claude API is unavailable.
    """
    from nl_parser import parse_intent

    heur = parse_intent(description)
    text = description.lower()

    use_case = heur["uc"]
    if use_case not in USE_CASES:
        use_case = "dc" if use_case == "hybrid" else "campus"

    scale_map = {"xsmall": "small", "small": "small", "medium": "medium",
                  "large": "large", "hyperscale": "large"}
    scale = scale_map.get(heur["orgSize"], "medium")

    redundancy = "single" if heur["redundancy"] == "single" else "dual"

    compliance_map = {"PCI-DSS": "PCI", "HIPAA": "HIPAA", "SOC2": "SOC2",
                       "FedRAMP": "FedRAMP", "ISO27001": "ISO27001", "NIST": "NIST_CSF"}
    compliance = [compliance_map[c] for c in heur["compliance"] if c in compliance_map]

    org_name = heur["orgName"] if heur["orgName"] != "NetDesign-Corp" else ""

    vendor = heur.get("_detected_vendor", "")
    vendor_prefs = [vendor] if vendor in VENDORS else []

    app_types: list[str] = []
    if any(k in text for k in ["voice", "voip", "phone", "sip"]):
        app_types.append("voice")
    if any(k in text for k in ["video", "conferenc", "webex", "zoom"]):
        app_types.append("video")
    if any(k in text for k in ["storage", "nvme", "san ", "iscsi", "nas"]):
        app_types.append("storage")
    if any(k in text for k in ["hpc", "gpu", "ai cluster", "ml cluster", "training", "inference"]):
        app_types.append("hpc")
    if any(k in text for k in ["internet", "isp", "transit", "public access"]):
        app_types.append("internet")

    return {
        "use_case":        use_case,
        "app_types":       app_types,
        "scale":           scale,
        "redundancy":      redundancy,
        "compliance":      compliance,
        "org_name":        org_name,
        "org_size":        "",
        "budget_tier":     "",
        "vendor_prefs":    vendor_prefs,
        "industry":        "",
        "primary_contact": "",
        "confidence":      0.5,
        "notes":           "Heuristic keyword-based extraction (ANTHROPIC_API_KEY not configured).",
    }
