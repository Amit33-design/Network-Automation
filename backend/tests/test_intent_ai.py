"""
Tests for intent_ai.py — Claude-powered Intent Parser (G-A1).
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

import intent_ai


def _fake_response(payload: dict):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(payload))])


def _request():
    return httpx.Request("POST", "https://api.anthropic.com/v1/messages")


VALID_RESULT = {
    "use_case": "dc",
    "app_types": ["storage"],
    "scale": "medium",
    "redundancy": "dual",
    "compliance": ["PCI"],
    "org_name": "Acme Corp",
    "org_size": "enterprise",
    "budget_tier": "enterprise",
    "vendor_prefs": ["Cisco"],
    "industry": "Financial",
    "primary_contact": "Jane Smith",
    "confidence": 0.9,
    "notes": "",
}


class TestParseIntentAI:
    def test_returns_none_when_api_key_not_configured(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", False)
        assert intent_ai.parse_intent_ai("Some description") is None

    def test_returns_parsed_dict_on_success(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _fake_response(VALID_RESULT)

        import anthropic
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        result = intent_ai.parse_intent_ai("A redundant DC for Acme Corp, PCI compliant")
        assert result == VALID_RESULT
        mock_client.messages.create.assert_called_once()
        _, kwargs = mock_client.messages.create.call_args
        assert kwargs["model"] == intent_ai.ANTHROPIC_MODEL
        assert kwargs["output_config"]["format"]["type"] == "json_schema"
        assert kwargs["output_config"]["format"]["schema"] == intent_ai.RESPONSE_SCHEMA
        assert kwargs["messages"] == [{"role": "user", "content": "A redundant DC for Acme Corp, PCI compliant"}]

    def test_returns_none_on_authentication_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "bad-key")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.AuthenticationError(
            message="invalid x-api-key",
            response=httpx.Response(status_code=401, request=_request()),
            body=None,
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_permission_denied_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.PermissionDeniedError(
            message="permission denied",
            response=httpx.Response(status_code=403, request=_request()),
            body=None,
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_not_found_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")
        monkeypatch.setattr(intent_ai, "ANTHROPIC_MODEL", "claude-bogus-model")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.NotFoundError(
            message="model not found",
            response=httpx.Response(status_code=404, request=_request()),
            body=None,
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_rate_limit_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.RateLimitError(
            message="rate limited",
            response=httpx.Response(status_code=429, request=_request()),
            body=None,
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_connection_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.APIConnectionError(
            message="connection error", request=_request()
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_generic_api_status_error(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.APIStatusError(
            message="server error",
            response=httpx.Response(status_code=500, request=_request()),
            body=None,
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_on_invalid_json_response(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic
        mock_client = MagicMock()
        mock_client.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(type="text", text="not json")]
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None

    def test_returns_none_when_no_text_block(self, monkeypatch):
        monkeypatch.setattr(intent_ai, "AI_AVAILABLE", True)
        monkeypatch.setattr(intent_ai, "ANTHROPIC_API_KEY", "test-key")

        import anthropic
        mock_client = MagicMock()
        mock_client.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", text=None)]
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: mock_client)

        assert intent_ai.parse_intent_ai("desc") is None


class TestHeuristicFallback:
    def test_dc_use_case_with_redundancy_and_compliance(self):
        result = intent_ai.heuristic_fallback(
            "We are building a new data center fabric with leaf-spine VXLAN EVPN. "
            "PCI-DSS compliant. Redundant design using Cisco switches, storage "
            "traffic over NVMe."
        )
        assert result["use_case"] == "dc"
        assert result["redundancy"] == "dual"
        assert "PCI" in result["compliance"]
        assert "Cisco" in result["vendor_prefs"]
        assert "storage" in result["app_types"]
        assert result["confidence"] == 0.5
        assert "Heuristic" in result["notes"]

    def test_unknown_use_case_falls_back_to_campus(self):
        result = intent_ai.heuristic_fallback("Just give me some generic network advice please.")
        assert result["use_case"] in intent_ai.USE_CASES

    def test_hybrid_use_case_maps_to_dc(self):
        result = intent_ai.heuristic_fallback(
            "We want a hybrid cloud and on-prem data center interconnect design."
        )
        assert result["use_case"] in intent_ai.USE_CASES

    def test_single_redundancy_maps_to_single(self):
        result = intent_ai.heuristic_fallback(
            "A small office lab network for a startup. Cost-sensitive, single "
            "switch design, no redundancy required."
        )
        assert result["redundancy"] == "single"

    def test_no_org_detected_yields_empty_org_name(self):
        result = intent_ai.heuristic_fallback("A small campus network with no redundancy.")
        assert result["org_name"] == ""

    def test_app_types_voice_video_internet_detection(self):
        result = intent_ai.heuristic_fallback(
            "Campus network supporting VoIP phones, Zoom video conferencing, and internet transit."
        )
        assert "voice" in result["app_types"]
        assert "video" in result["app_types"]
        assert "internet" in result["app_types"]

    def test_scale_mapping_hyperscale_to_large(self):
        result = intent_ai.heuristic_fallback(
            "A hyperscale GPU cluster for AI training with thousands of endpoints."
        )
        assert result["scale"] in intent_ai.SCALES

    def test_vendor_prefs_only_includes_known_frontend_vendors(self):
        result = intent_ai.heuristic_fallback(
            "A SONiC-based data center fabric with open networking switches."
        )
        for v in result["vendor_prefs"]:
            assert v in intent_ai.VENDORS

    def test_result_matches_response_schema_keys(self):
        result = intent_ai.heuristic_fallback("A medium campus network for a school district.")
        assert set(result.keys()) == set(intent_ai.RESPONSE_SCHEMA["required"])
