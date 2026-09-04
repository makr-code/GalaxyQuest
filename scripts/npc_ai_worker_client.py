#!/usr/bin/env python3
"""Reference external Python worker for signed NPC AI queue claim/complete API."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import secrets
import time
from dataclasses import dataclass
from hashlib import sha256
from hmac import new as hmac_new
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    """Configuration for the external NPC AI worker."""

    api_base_url: str = Field(
        default="http://127.0.0.1:8080/api/npc_ai_worker.php",
        description="Worker API endpoint URL.",
    )
    shared_secret: str = Field(default="", description="Shared HMAC secret.")
    worker_id: str = Field(default="py-worker-1", description="Unique worker id.")
    claim_limit: int = Field(default=10, description="Requested claim batch size.")
    poll_interval_seconds: float = Field(default=2.0, description="Idle polling interval.")
    request_timeout_seconds: float = Field(default=15.0, description="HTTP timeout.")

    model_config = SettingsConfigDict(
        env_prefix="NPC_AI_WORKER_",
        env_file=".env",
        extra="ignore",
    )


WORKER_ID_PATTERN = re.compile(r"^[a-zA-Z0-9:_-]{3,64}$")


class ClaimRequest(BaseModel):
    limit: int = Field(default=10, ge=1, le=100)


class ClaimedJob(BaseModel):
    queue_id: int = Field(ge=1)
    user_id: int = Field(ge=1)
    faction_id: int = Field(ge=1)
    attempts: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    claim_token: str = Field(min_length=64, max_length=64)


class ClaimResponse(BaseModel):
    success: bool
    worker_id: str
    claimed: int
    jobs: list[ClaimedJob] = Field(default_factory=list)


class CompletionRequest(BaseModel):
    queue_id: int = Field(ge=1)
    claim_token: str = Field(min_length=64, max_length=64)
    ok: bool
    result: dict[str, Any] = Field(default_factory=dict)
    error_message: str = ""


class CompletionResponse(BaseModel):
    success: bool
    worker_id: str
    queue_id: int
    accepted: bool


@dataclass(frozen=True)
class WorkerDecision:
    ok: bool
    result: dict[str, Any]
    error_message: str = ""


def configure_logging() -> structlog.BoundLogger:
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )
    return structlog.get_logger("npc-ai-worker")


def build_signature(
    worker_id: str,
    timestamp: int,
    nonce: str,
    raw_json_body: str,
    shared_secret: str,
) -> str:
    canonical = f"{worker_id}\n{timestamp}\n{nonce}\n{raw_json_body}"
    return hmac_new(shared_secret.encode("utf-8"), canonical.encode("utf-8"), sha256).hexdigest()


def encode_json_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


async def signed_post(
    client: httpx.AsyncClient,
    settings: WorkerSettings,
    action: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    raw_body = encode_json_payload(payload)
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(24)
    signature = build_signature(
        worker_id=settings.worker_id,
        timestamp=timestamp,
        nonce=nonce,
        raw_json_body=raw_body,
        shared_secret=settings.shared_secret,
    )
    headers = {
        "Content-Type": "application/json",
        "X-Worker-Id": settings.worker_id,
        "X-Worker-Timestamp": str(timestamp),
        "X-Worker-Nonce": nonce,
        "X-Worker-Signature": signature,
    }
    response = await client.post(
        settings.api_base_url,
        params={"action": action},
        content=raw_body.encode("utf-8"),
        headers=headers,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Worker API response must be a JSON object.")
    return data


async def claim_jobs(
    client: httpx.AsyncClient,
    settings: WorkerSettings,
) -> list[ClaimedJob]:
    payload = ClaimRequest(limit=settings.claim_limit).model_dump()
    data = await signed_post(client, settings, "claim", payload)
    parsed = ClaimResponse.model_validate(data)
    if parsed.worker_id != settings.worker_id:
        raise ValueError("Worker API returned mismatched worker_id.")
    return parsed.jobs


def decide_job(job: ClaimedJob) -> WorkerDecision:
    """Placeholder strategy; replace with real Python AI decision logic for production."""

    lore_lock = bool(job.payload.get("lore_lock", True))
    result = {
        "handled": False,
        "reason": "python_worker_placeholder",
        "policy": {
            "lore_lock": lore_lock,
            "action": "none",
        },
    }
    return WorkerDecision(ok=True, result=result)


async def complete_job(
    client: httpx.AsyncClient,
    settings: WorkerSettings,
    job: ClaimedJob,
    decision: WorkerDecision,
) -> CompletionResponse:
    payload = CompletionRequest(
        queue_id=job.queue_id,
        claim_token=job.claim_token,
        ok=decision.ok,
        result=decision.result,
        error_message=decision.error_message,
    ).model_dump()
    data = await signed_post(client, settings, "complete", payload)
    return CompletionResponse.model_validate(data)


async def run_once(client: httpx.AsyncClient, settings: WorkerSettings, log: structlog.BoundLogger) -> int:
    jobs = await claim_jobs(client, settings)
    if not jobs:
        log.info("worker_idle")
        return 0

    processed = 0
    for job in jobs:
        try:
            decision = decide_job(job)
            completion = await complete_job(client, settings, job, decision)
            log.info(
                "job_completed",
                queue_id=job.queue_id,
                accepted=completion.accepted,
                attempts=job.attempts,
                max_attempts=job.max_attempts,
            )
            processed += 1
        except (httpx.HTTPError, ValidationError, ValueError, RuntimeError) as exc:
            log.warning(
                "job_complete_failed",
                queue_id=job.queue_id,
                error=str(exc),
            )
        except Exception as exc:  # Defensive isolation for plugin/runtime errors.
            log.error(
                "job_complete_unexpected_error",
                queue_id=job.queue_id,
                error=str(exc),
            )
    return processed


async def run_worker(*, once: bool) -> None:
    settings = WorkerSettings()
    if settings.shared_secret.strip() == "":
        raise RuntimeError("NPC_AI_WORKER_SHARED_SECRET must be set.")
    if WORKER_ID_PATTERN.fullmatch(settings.worker_id) is None:
        raise RuntimeError("NPC_AI_WORKER_WORKER_ID must match [a-zA-Z0-9:_-]{3,64}.")

    log = configure_logging()
    timeout = httpx.Timeout(settings.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if once:
            await run_once(client, settings, log)
            return

        while True:
            try:
                processed = await run_once(client, settings, log)
                if processed == 0:
                    await asyncio.sleep(max(0.2, settings.poll_interval_seconds))
            except httpx.HTTPError as exc:
                log.warning("worker_http_error", error=str(exc))
                await asyncio.sleep(max(1.0, settings.poll_interval_seconds))
            except (ValidationError, ValueError, RuntimeError) as exc:
                log.error("worker_unhandled_error", error=str(exc))
                await asyncio.sleep(max(1.0, settings.poll_interval_seconds))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GalaxyQuest NPC AI signed worker client.")
    parser.add_argument("--once", action="store_true", help="Process one claim batch and exit.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(run_worker(once=args.once))


if __name__ == "__main__":
    main()
