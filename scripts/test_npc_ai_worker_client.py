#!/usr/bin/env python3
"""Unit tests for the signed NPC AI Python worker reference client."""

from __future__ import annotations

import json
import sys
import unittest
from hashlib import sha256
from hmac import new as hmac_new
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import npc_ai_worker_client as worker  # noqa: E402


class WorkerClientHelpersTest(unittest.TestCase):
    def test_build_signature_is_deterministic(self) -> None:
        signature = worker.build_signature(
            worker_id="py-worker-1",
            timestamp=1_760_000_000,
            nonce="nonce-value",
            raw_json_body='{"limit":10}',
            shared_secret="secret",
        )
        canonical = 'py-worker-1\n1760000000\nnonce-value\n{"limit":10}'
        expected = hmac_new(b"secret", canonical.encode("utf-8"), sha256).hexdigest()
        self.assertEqual(
            signature,
            expected,
        )

    def test_encode_json_payload_is_compact_and_sorted(self) -> None:
        payload = {"z": 1, "a": {"b": 2}}
        encoded = worker.encode_json_payload(payload)
        self.assertEqual(encoded, '{"a":{"b":2},"z":1}')

        decoded = json.loads(encoded)
        self.assertEqual(decoded["a"]["b"], 2)
        self.assertEqual(decoded["z"], 1)

    def test_worker_id_pattern_validates_format(self) -> None:
        self.assertIsNotNone(worker.WORKER_ID_PATTERN.fullmatch("py-worker_1"))
        self.assertIsNone(worker.WORKER_ID_PATTERN.fullmatch("x"))
        self.assertIsNone(worker.WORKER_ID_PATTERN.fullmatch("bad worker id"))


class WorkerClientModelsTest(unittest.TestCase):
    def test_claim_response_model_parses_valid_payload(self) -> None:
        parsed = worker.ClaimResponse.model_validate(
            {
                "success": True,
                "worker_id": "py-worker-1",
                "claimed": 1,
                "jobs": [
                    {
                        "queue_id": 42,
                        "user_id": 7,
                        "faction_id": 3,
                        "attempts": 1,
                        "max_attempts": 3,
                        "payload": {"lore_lock": True},
                        "claim_token": "a" * 64,
                    }
                ],
            }
        )
        self.assertEqual(parsed.claimed, 1)
        self.assertEqual(parsed.jobs[0].queue_id, 42)
        self.assertTrue(parsed.jobs[0].payload["lore_lock"])

    def test_completion_response_rejects_invalid_shape(self) -> None:
        with self.assertRaises(ValidationError):
            worker.CompletionResponse.model_validate(
                {
                    "success": True,
                    "worker_id": "py-worker-1",
                    # queue_id missing
                    "accepted": True,
                }
            )


if __name__ == "__main__":
    unittest.main()
