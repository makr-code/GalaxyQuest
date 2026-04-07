<?php

declare(strict_types=1);

/**
 * ThemisDbClient – lightweight PHP HTTP client for the ThemisDB REST/AQL API.
 *
 * Migration Phase 0 abstraction layer.  Wraps the ThemisDB HTTP API so that
 * GalaxyQuest PHP code can interact with ThemisDB without a native extension.
 *
 * Supported transports:
 *   • AQL queries  – POST /api/query  (multi-model: relational, graph, vector)
 *   • Documents    – CRUD on /api/collections/{name}/documents
 *   • Health-check – GET  /health
 *
 * All methods return an associative array:
 *   ['ok' => bool, 'data' => mixed, 'status' => int, 'error' => string|null]
 *
 * Usage:
 *   $client = ThemisDbClient::instance();
 *   $result = $client->queryAql('FOR u IN users FILTER u.id == @id RETURN u', ['id' => 42]);
 *   if ($result['ok']) { $rows = $result['data']['result']; }
 *
 * @see docs/technical/THEMISDB_MIGRATION_ROADMAP.md
 */
final class ThemisDbClient
{
    private string $baseUrl;
    private int    $timeoutSeconds;
    private string $apiToken;

    // ── Singleton ────────────────────────────────────────────────────────────

    private static ?self $instance = null;

    private function __construct(string $baseUrl, int $timeoutSeconds, string $apiToken)
    {
        $this->baseUrl        = rtrim($baseUrl, '/');
        $this->timeoutSeconds = max(1, $timeoutSeconds);
        $this->apiToken       = $apiToken;
    }

    /**
     * Returns the shared singleton, configured from the global THEMISDB_* constants.
     * Constants must be defined before the first call (config/config.php does this).
     */
    public static function instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self(
                (string) (defined('THEMISDB_BASE_URL')        ? THEMISDB_BASE_URL        : 'http://localhost:8090'),
                (int)    (defined('THEMISDB_TIMEOUT_SECONDS') ? THEMISDB_TIMEOUT_SECONDS : 10),
                (string) (defined('THEMISDB_API_TOKEN')       ? THEMISDB_API_TOKEN       : ''),
            );
        }
        return self::$instance;
    }

    /**
     * Creates a fresh client (useful for testing / overriding config at runtime).
     */
    public static function create(string $baseUrl, int $timeoutSeconds = 10, string $apiToken = ''): self
    {
        return new self($baseUrl, $timeoutSeconds, $apiToken);
    }

    // ── Health ────────────────────────────────────────────────────────────────

    /**
     * GET /health – returns true when ThemisDB responds with HTTP 200.
     */
    public function isHealthy(): bool
    {
        $result = $this->request('GET', '/health');
        return $result['ok'];
    }

    // ── AQL Query ─────────────────────────────────────────────────────────────

    /**
     * Execute an AQL query.
     *
     * POST /api/query
     * Body: { "query": "<AQL>", "bind_vars": { ... }, "batch_size": N }
     *
     * @param  string               $aql       AQL query string.
     * @param  array<string, mixed> $bindVars  Named bind parameters (prefixed with @).
     * @param  int                  $batchSize Max results per call (default 1 000).
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function queryAql(string $aql, array $bindVars = [], int $batchSize = 1000): array
    {
        return $this->request('POST', '/api/query', [
            'query'      => $aql,
            'bind_vars'  => $bindVars,
            'batch_size' => $batchSize,
        ]);
    }

    // ── Document CRUD ─────────────────────────────────────────────────────────

    /**
     * Insert a document into a collection.
     *
     * POST /api/collections/{collection}/documents
     *
     * @param  string               $collection Collection name.
     * @param  array<string, mixed> $document   Document data.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function insertDocument(string $collection, array $document): array
    {
        return $this->request('POST', '/api/collections/' . rawurlencode($collection) . '/documents', $document);
    }

    /**
     * Retrieve a document by its key.
     *
     * GET /api/collections/{collection}/documents/{key}
     *
     * @param  string $collection Collection name.
     * @param  string $key        Document key (_key field).
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function getDocument(string $collection, string $key): array
    {
        return $this->request('GET', '/api/collections/' . rawurlencode($collection) . '/documents/' . rawurlencode($key));
    }

    /**
     * Replace a document.
     *
     * PUT /api/collections/{collection}/documents/{key}
     *
     * @param  string               $collection Collection name.
     * @param  string               $key        Document key.
     * @param  array<string, mixed> $document   New document data.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function replaceDocument(string $collection, string $key, array $document): array
    {
        return $this->request(
            'PUT',
            '/api/collections/' . rawurlencode($collection) . '/documents/' . rawurlencode($key),
            $document
        );
    }

    /**
     * Partially update a document.
     *
     * PATCH /api/collections/{collection}/documents/{key}
     *
     * @param  string               $collection Collection name.
     * @param  string               $key        Document key.
     * @param  array<string, mixed> $patch      Fields to update.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function patchDocument(string $collection, string $key, array $patch): array
    {
        return $this->request(
            'PATCH',
            '/api/collections/' . rawurlencode($collection) . '/documents/' . rawurlencode($key),
            $patch
        );
    }

    /**
     * Delete a document.
     *
     * DELETE /api/collections/{collection}/documents/{key}
     *
     * @param  string $collection Collection name.
     * @param  string $key        Document key.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function deleteDocument(string $collection, string $key): array
    {
        return $this->request(
            'DELETE',
            '/api/collections/' . rawurlencode($collection) . '/documents/' . rawurlencode($key)
        );
    }

    // ── Bulk Import ───────────────────────────────────────────────────────────

    /**
     * Bulk-import an array of documents into a collection.
     *
     * POST /api/collections/{collection}/import
     * Body: { "documents": [ ... ], "on_duplicate": "update|error|ignore" }
     *
     * @param  string                       $collection  Collection name.
     * @param  array<int, array<string,mixed>> $documents Array of document objects.
     * @param  string                       $onDuplicate Conflict strategy: 'update', 'error', or 'ignore'.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function bulkImport(string $collection, array $documents, string $onDuplicate = 'update'): array
    {
        return $this->request('POST', '/api/collections/' . rawurlencode($collection) . '/import', [
            'documents'    => $documents,
            'on_duplicate' => $onDuplicate,
        ]);
    }

    // ── LLM / RAG ─────────────────────────────────────────────────────────────

    /**
     * Execute an LLM inference request via ThemisDB.
     *
     * POST /api/llm/infer
     * Body: { "model": "...", "prompt": "...", "lora": "...", "max_tokens": N, "temperature": F }
     *
     * @param  string               $prompt      Prompt text.
     * @param  array<string, mixed> $options     Optional keys: model, lora, max_tokens, temperature, system.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function llmInfer(string $prompt, array $options = []): array
    {
        $payload = array_merge([
            'model'       => 'gq-main',
            'prompt'      => $prompt,
            'max_tokens'  => 512,
            'temperature' => 0.7,
        ], $options);

        return $this->request('POST', '/api/llm/infer', $payload);
    }

    /**
     * Generate an embedding vector for a text.
     *
     * POST /api/llm/embed
     * Body: { "model": "...", "text": "..." }
     *
     * @param  string $text  Text to embed.
     * @param  string $model Embedding model alias (default: all-minilm-l6-v2).
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function llmEmbed(string $text, string $model = 'all-minilm-l6-v2'): array
    {
        return $this->request('POST', '/api/llm/embed', [
            'model' => $model,
            'text'  => $text,
        ]);
    }

    /**
     * Perform a RAG (Retrieval-Augmented Generation) query.
     *
     * POST /api/llm/rag
     * Body: { "model": "...", "query": "...", "collection": "...", "top_k": N, "filter": {...} }
     *
     * @param  string               $query       Natural language query.
     * @param  string               $collection  Vector collection to search.
     * @param  array<string, mixed> $options     Optional keys: model, lora, top_k, filter, temperature.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function llmRag(string $query, string $collection, array $options = []): array
    {
        $payload = array_merge([
            'model'      => 'gq-main',
            'query'      => $query,
            'collection' => $collection,
            'top_k'      => 8,
        ], $options);

        return $this->request('POST', '/api/llm/rag', $payload);
    }

    // ── Schema Provisioning ───────────────────────────────────────────────────

    /**
     * Idempotently create a collection.
     *
     * @param  string $name       Collection name.
     * @param  string $type       'collection' | 'document' | 'edge'
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function ensureCollection(string $name, string $type = 'collection'): array
    {
        return $this->request('PUT', '/api/collection/' . rawurlencode($name), [
            'name' => $name,
            'type' => $type,
        ]);
    }

    /**
     * Idempotently create an index on a collection.
     *
     * @param  string   $collection Target collection name.
     * @param  string   $type       'persistent' | 'geo' | 'fulltext' | 'ttl'
     * @param  string[] $fields     Field paths to index.
     * @param  bool     $unique     Whether the index enforces uniqueness.
     * @param  bool     $sparse     Whether to skip null/missing values.
     * @param  bool     $geoJson    For geo indexes: treat as GeoJSON.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function ensureIndex(
        string $collection,
        string $type,
        array  $fields,
        bool   $unique  = false,
        bool   $sparse  = false,
        bool   $geoJson = false
    ): array {
        $body = [
            'type'   => $type,
            'fields' => $fields,
        ];
        if ($unique)  { $body['unique']  = true; }
        if ($sparse)  { $body['sparse']  = true; }
        if ($geoJson) { $body['geoJson'] = true; }

        return $this->request(
            'POST',
            '/api/index/' . rawurlencode($collection),
            $body
        );
    }

    /**
     * Idempotently create a named graph with its edge definitions.
     *
     * @param  string                                                       $name      Graph name.
     * @param  array<int, array{collection: string, from: string[], to: string[]}>  $edgeDefs  Edge collection definitions.
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    public function ensureGraph(string $name, array $edgeDefs): array
    {
        return $this->request('PUT', '/api/graph/' . rawurlencode($name), [
            'name'             => $name,
            'edgeDefinitions'  => $edgeDefs,
        ]);
    }

    // ── Dual-write Helper ─────────────────────────────────────────────────────

    /**
     * Fire-and-forget dual-write: mirrors a document write to ThemisDB after the
     * primary MySQL write succeeds.  Errors are logged but never propagate to the
     * caller, preserving MySQL-first behaviour during Phase 0/1.
     *
     * @param  string               $collection  Target ThemisDB collection.
     * @param  array<string, mixed> $document    Document to upsert (should include _key).
     * @param  string               $context     Descriptive label for error logs.
     */
    public function dualWriteDocument(string $collection, array $document, string $context = ''): void
    {
        if ((int) (defined('THEMISDB_DUAL_WRITE') ? THEMISDB_DUAL_WRITE : 0) !== 1) {
            return;
        }

        try {
            $result = $this->bulkImport($collection, [$document], 'update');
            if (!$result['ok']) {
                error_log(sprintf(
                    '[ThemisDB dual-write WARN] %s → collection=%s status=%d error=%s',
                    $context,
                    $collection,
                    $result['status'],
                    $result['error'] ?? 'unknown'
                ));
            }
        } catch (Throwable $e) {
            error_log(sprintf(
                '[ThemisDB dual-write ERROR] %s → collection=%s %s: %s',
                $context,
                $collection,
                get_class($e),
                $e->getMessage()
            ));
        }
    }

    // ── Internal HTTP transport ───────────────────────────────────────────────

    /**
     * @param  string               $method  HTTP method (GET, POST, PUT, PATCH, DELETE).
     * @param  string               $path    URL path starting with '/'.
     * @param  array<string, mixed>|null $body Request body (will be JSON-encoded).
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    private function request(string $method, string $path, ?array $body = null): array
    {
        $url = $this->baseUrl . $path;

        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
        ];

        if ($this->apiToken !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->apiToken;
        }

        $encodedBody = null;
        if ($body !== null) {
            $encodedBody = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($encodedBody === false) {
                return [
                    'ok'     => false,
                    'data'   => null,
                    'status' => 0,
                    'error'  => 'Failed to JSON-encode request body.',
                ];
            }
            $headers[] = 'Content-Length: ' . strlen($encodedBody);
        }

        $context = stream_context_create([
            'http' => [
                'method'        => strtoupper($method),
                'timeout'       => $this->timeoutSeconds,
                'header'        => implode("\r\n", $headers),
                'content'       => $encodedBody ?? '',
                'ignore_errors' => true,
            ],
        ]);

        $t0  = hrtime(true);
        $raw = @file_get_contents($url, false, $context);
        $ms  = (int) round((hrtime(true) - $t0) / 1e6);

        if ($raw === false) {
            $err = error_get_last();
            return [
                'ok'     => false,
                'data'   => null,
                'status' => 0,
                'error'  => 'ThemisDB request failed: ' . (string) ($err['message'] ?? 'stream error'),
            ];
        }

        // Parse HTTP status from response headers.
        // $http_response_header is a PHP superglobal automatically populated by
        // file_get_contents() after a successful stream operation.  It contains
        // the raw HTTP response header lines, e.g. ["HTTP/1.1 200 OK", ...].
        $httpStatus = 200;
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $line) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', (string) $line, $m)) {
                    $httpStatus = (int) $m[1];
                    break;
                }
            }
        }

        if (defined('SLOW_QUERY_THRESHOLD_MS') && $ms >= SLOW_QUERY_THRESHOLD_MS) {
            error_log(sprintf('[ThemisDB slow-query %dms] %s %s', $ms, strtoupper($method), $path));
        }

        return $this->decodeResponse($raw, $httpStatus);
    }

    /**
     * @return array{ok: bool, data: mixed, status: int, error: string|null}
     */
    private function decodeResponse(string $raw, int $status): array
    {
        $decoded = json_decode($raw, true);

        if (!is_array($decoded)) {
            $trimmed = trim($raw);
            return [
                'ok'     => false,
                'data'   => null,
                'status' => $status,
                'error'  => $trimmed !== '' ? $trimmed : 'Invalid JSON response from ThemisDB.',
            ];
        }

        if ($status < 200 || $status >= 300) {
            $message = (string) ($decoded['error'] ?? ($decoded['message'] ?? ('ThemisDB responded with HTTP ' . $status)));
            return [
                'ok'     => false,
                'data'   => $decoded,
                'status' => $status,
                'error'  => $message,
            ];
        }

        return [
            'ok'     => true,
            'data'   => $decoded,
            'status' => $status,
            'error'  => null,
        ];
    }
}
