# ADR-001: Unified Error Envelope for All API Responses

**Date**: 2026-07-31

**Status**: Accepted

**Context**

Previous API endpoints returned heterogeneous error formats, making client-side error handling complex and inconsistent.

We need a single, standardized error envelope that:
- Clearly distinguishes success from error responses
- Provides error codes for programmatic handling
- Includes optional details for debugging
- Maintains correlation with trace IDs for logging
- Works across all bounded contexts

**Decision**

All API responses use a unified envelope format:

**Success Response:**
```json
{
  "success": true,
  "data": { /* response data */ },
  "meta": {
    "trace_id": "abc123...",
    "ts": 1710000000000
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "AUTH_UNAUTHORIZED",
    "message": "User is not authenticated",
    "details": { /* optional debug info */ }
  },
  "meta": {
    "trace_id": "abc123...",
    "ts": 1710000000000
  }
}
```

**Error Code Registry**

A curated list of error codes defined in `src/Shared/Http/ApiError.php`:
- AUTH_UNAUTHORIZED
- AUTH_CSRF_INVALID
- VALIDATION_FAILED
- GALAXY_RANGE_INVALID
- GALAXY_SYSTEM_NOT_FOUND
- COLONY_NOT_FOUND
- FLEET_NOT_FOUND
- NETWORK_UNREACHABLE
- INTERNAL_ERROR

New codes are added by updating the registry, never ad-hoc in responses.

**Consequences**

**Positive:**
- Consistent error handling across all clients
- Trace ID enables request correlation in logs
- Error codes enable client-side recovery logic
- Backward compatible if old endpoints wrapped with envelope

**Negative:**
- All endpoints must be updated to use new envelope
- Clients must be updated to parse new format (migrate via bridge pattern)

**Implementation**

- `src/Shared/Http/ApiResponse.php` – envelope utility
- `src/Shared/Http/ApiError.php` – error code registry
- All Controllers use `ApiResponse::success()` or `ApiResponse::error()`
- CI gate ensures no responses bypass envelope
