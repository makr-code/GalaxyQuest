<?php
/**
 * RAG-based Glossary API with Ollama LLM + Wikipedia
 * 
 * POST /api/glossary.php?action=generate body: {term}
 * 
 * Retrieves Wikipedia content, generates enhanced definition via Ollama LLM.
 * Serves from cache if available (5day TTL).
 */
require_once __DIR__ . '/helpers.php';

require_auth();

$action = (string)($_GET['action'] ?? 'definition');
if ($action === 'generate') {
    only_method('POST');
    verify_csrf();
    $body = get_json_body();
    $term_key = (string)($body['term'] ?? '');
} else {
    only_method('GET');
    $term_key = (string)($_GET['term'] ?? '');
}

// Validate term (prevent injection)
if (!preg_match('/^[a-z_]{2,30}$/', $term_key)) {
    json_error('Invalid term key', 400);
    exit;
}

$db = get_db();

// ─── Action: Generate LLM definition via RAG ─────────────────────────────────
if ($action === 'generate') {
    generate_rag_definition($db, $term_key);
    exit;
}

// ─── Action: Retrieve cached or static definition ─────────────────────────────
json_ok([
    'action' => 'definition',
    'term' => $term_key,
    'source' => 'glossary_cache',
    'message' => 'Use action=generate to get LLM-enhanced definition'
]);
exit;

// ─── RAG Pipeline ───────────────────────────────────────────────────────────

/**
 * Generate a definition using Ollama LLM with Wikipedia RAG
 */
function generate_rag_definition(PDO $db, string $termKey): void {
    ensure_glossary_cache_table($db);
    // Check cache first (5 days TTL)
    $cached = get_glossary_cache($db, $termKey);
    if ($cached) {
        json_ok($cached);
        return;
    }

    try {
        // Step 1: Get term metadata (Wikipedia URL, category)
        $metadata = get_term_metadata($termKey);
        if (!$metadata) {
            json_error('Unknown term', 404);
            return;
        }

        // Step 2: Fetch Wikipedia content for RAG context
        $wikipediaContext = fetch_wikipedia_context($metadata['wikipedia_url']);
        if (!$wikipediaContext) {
            json_error('Failed to fetch Wikipedia context', 500);
            return;
        }

        // Step 3: Generate definition via Ollama LLM
        $llmDefinition = generate_llm_definition(
            $metadata['term'],
            $metadata['category'],
            $wikipediaContext
        );

        if (!$llmDefinition) {
            json_error('Failed to generate LLM definition', 500);
            return;
        }

        // Step 4: Cache result
        $result = [
            'term' => $metadata['term'],
            'term_key' => $termKey,
            'category' => $metadata['category'],
            'short' => $llmDefinition['short'],
            'full' => $llmDefinition['full'],
            'wikipedia_url' => $metadata['wikipedia_url'],
            'arxiv_url' => $metadata['arxiv_url'] ?? null,
            'source' => 'ollama_rag',
            'generated_at' => gmdate('c'),
            'tokens_used' => $llmDefinition['tokens'] ?? 0,
        ];

        cache_glossary_definition($db, $termKey, $result);

        json_ok($result);
    } catch (Exception $e) {
        error_log('Glossary RAG error: ' . $e->getMessage());
        json_error('Internal error: ' . $e->getMessage(), 500);
    }
}

/**
 * Fetch Wikipedia excerpt for RAG context
 * @return string|null
 */
function fetch_wikipedia_context(string $wikipediaUrl): ?string {
    // Extract article title from URL
    if (!preg_match('/\/wiki\/(.+)$/i', $wikipediaUrl, $m)) {
        return null;
    }

    $title = urldecode($m[1]);

    try {
        // Call Wikipedia REST API to get page summary
        $url = "https://en.wikipedia.org/api/rest_v1/page/summary/" . urlencode($title);
        
        $ctx = stream_context_create([
            'http' => [
                'timeout' => 5,
                'user_agent' => 'GalaxyQuest/1.0',
            ]
        ]);

        $response = @file_get_contents($url, false, $ctx);
        if (!$response) {
            return null;
        }

        $data = json_decode($response, true);
        
        // Return excerpt + extract paragraphs
        if (isset($data['extract'])) {
            return $data['extract'];
        }

        return null;
    } catch (Exception $e) {
        error_log('Wikipedia fetch error: ' . $e->getMessage());
        return null;
    }
}

/**
 * Generate definition using Ollama LLM with RAG context
 * @return array{short:string, full:string, tokens:int}|null
 */
function generate_llm_definition(string $term, string $category, string $context): ?array {
    // Read from environment or .env/config
    $ollamaUrl = trim((string)(getenv('OLLAMA_URL') ?: $_ENV['OLLAMA_URL'] ?? ''));
    $model = trim((string)(getenv('OLLAMA_MODEL') ?: $_ENV['OLLAMA_MODEL'] ?? ''));
    
    if (!$ollamaUrl) {
        $ollamaUrl = 'http://localhost:11434';
    }
    if (!$model) {
        $model = 'mistral';
    }

    // Build prompt with RAG context
    $systemPrompt = "You are a scientific educator explaining astronomical and physics terms for a space strategy game. "
        . "Provide concise, accurate, memorable explanations.";

    $userPrompt = "Based on this Wikipedia context, generate a scientific definition for: $term\n\n"
        . "Category: $category\n\n"
        . "Wikipedia context:\n$context\n\n"
        . "Provide:\n"
        . "1. SHORT (1-2 sentences, memorable)\n"
        . "2. FULL (3-4 sentences, detailed)\n\n"
        . "Format as JSON: {\"short\": \"...\", \"full\": \"...\"}";

    try {
        $olmBody = json_encode([
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userPrompt],
            ],
            'stream' => false,
        ]);

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => $olmBody,
                'timeout' => 30,
            ]
        ]);

        $response = @file_get_contents($ollamaUrl . '/api/chat', false, $ctx);
        if (!$response) {
            error_log("Ollama connection failed at $ollamaUrl");
            return null;
        }

        $data = json_decode($response, true);
        if (!isset($data['message']['content'])) {
            error_log('Ollama invalid response: ' . json_encode($data));
            return null;
        }

        $content = $data['message']['content'];

        // Parse response: Try JSON first, then text parsing
        $definition = _parse_llm_response($content, $model);
        
        if ($definition && isset($definition['short']) && isset($definition['full'])) {
            return [
                'short' => trim($definition['short']),
                'full' => trim($definition['full']),
                'tokens' => $data['eval_count'] ?? 0,
            ];
        }

        return null;
    } catch (Exception $e) {
        error_log('Ollama generation error: ' . $e->getMessage());
        return null;
    }
}

/**
 * Parse LLM response in multiple formats
 * @private
 */
function _parse_llm_response(string $content, string $model): ?array {
    // Format 1: JSON object
    if (preg_match('/\{[\s\S]*"short"[\s\S]*"full"[\s\S]*\}/i', $content, $m)) {
        $parsed = json_decode($m[0], true);
        if (isset($parsed['short']) && isset($parsed['full'])) {
            return $parsed;
        }
    }

    // Format 2: Key-value pairs (SHORT: ... FULL: ...)
    if (preg_match('/SHORT\s*[:=—\-]\s*(.+?)(?:FULL|$)/is', $content, $m1)) {
        if (preg_match('/FULL\s*[:=—\-]\s*(.+?)$/is', $content, $m2)) {
            return [
                'short' => trim($m1[1]),
                'full' => trim($m2[1]),
            ];
        }
    }

    // Format 3: Markdown headers (## SHORT vs ## FULL)
    if (preg_match('/##\s*SHORT[\s\S]*?\n(.+?)(?:##|$)/i', $content, $m1)) {
        if (preg_match('/##\s*FULL[\s\S]*?\n(.+?)$/i', $content, $m2)) {
            return [
                'short' => trim($m1[1]),
                'full' => trim($m2[1]),
            ];
        }
    }

    // Format 4: Numbered points (1. ... 2. ...)
    if (preg_match('/1\.\s*(.+?)(?:2\.|$)/is', $content, $m1)) {
        if (preg_match('/2\.\s*(.+?)$/is', $content, $m2)) {
            return [
                'short' => trim($m1[1]),
                'full' => trim($m2[1]),
            ];
        }
    }

    return null;
}

// ─── Old response parsing (fallback, deprecated) ────────────────────────────
// Remove after testing, but keep function name for backwards compatibility
function generate_llm_definition_legacy(string $term, string $category, string $context): ?array {
    return null;  // Deprecated: Use generate_llm_definition()
}

/**
 * Static term metadata (fallback)
 */
function get_term_metadata(string $termKey): ?array {
    $metadata = [
        'white_dwarf' => [
            'term' => 'White Dwarf',
            'category' => 'Stellar Type',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/White_dwarf',
            'arxiv_url' => 'https://arxiv.org/abs/1303.2916',
        ],
        'main_sequence' => [
            'term' => 'Main Sequence',
            'category' => 'Stellar Classification',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Main_sequence',
            'arxiv_url' => 'https://arxiv.org/abs/astro-ph/0202124',
        ],
        'habitable_zone' => [
            'term' => 'Habitable Zone',
            'category' => 'Planetary Habitability',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Habitable_zone',
            'arxiv_url' => 'https://arxiv.org/abs/1301.6674',
        ],
        'spectral_class' => [
            'term' => 'Spectral Class',
            'category' => 'Stellar Classification',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Stellar_classification',
            'arxiv_url' => 'https://arxiv.org/abs/astro-ph/0108020',
        ],
        'luminosity' => [
            'term' => 'Luminosity',
            'category' => 'Stellar Properties',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Luminosity',
            'arxiv_url' => 'https://arxiv.org/abs/1509.05143',
        ],
        'stellar_temperature' => [
            'term' => 'Stellar Temperature',
            'category' => 'Stellar Properties',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Effective_temperature',
            'arxiv_url' => 'https://arxiv.org/abs/1210.7467',
        ],
        'binary_system' => [
            'term' => 'Binary Star System',
            'category' => 'Stellar Dynamics',
            'wikipedia_url' => 'https://en.wikipedia.org/wiki/Binary_star',
            'arxiv_url' => 'https://arxiv.org/abs/1302.6254',
        ],
    ];

    return $metadata[$termKey] ?? null;
}

/**
 * Retrieve cached definition
 */
function get_glossary_cache(PDO $db, string $termKey): ?array {
    ensure_glossary_cache_table($db);
    try {
        $stmt = $db->prepare(
            'SELECT definition_json, generated_at FROM glossary_cache
             WHERE term_key = ? AND generated_at > DATE_SUB(NOW(), INTERVAL 5 DAY)
             LIMIT 1'
        );
        $stmt->execute([$termKey]);
        $row = $stmt->fetch();

        if ($row) {
            $data = json_decode($row['definition_json'], true);
            $data['cached_at'] = $row['generated_at'];
            return $data;
        }

        return null;
    } catch (PDOException $e) {
        error_log('Glossary cache read failed: ' . $e->getMessage());
        throw $e;
    }
}

/**
 * Cache definition result
 */
function cache_glossary_definition(PDO $db, string $termKey, array $definition): void {
    ensure_glossary_cache_table($db);
    try {
        $db->prepare(
            'INSERT INTO glossary_cache (term_key, definition_json, generated_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                definition_json = VALUES(definition_json),
                generated_at = NOW()'
        )->execute([
            $termKey,
            json_encode($definition),
        ]);
    } catch (PDOException $e) {
        error_log('Cache write failed: ' . $e->getMessage());
        throw $e;
    }
}

function ensure_glossary_cache_table(PDO $db): void
{
    require_once __DIR__ . '/../lib/GalaxySchema.php';
    \GalaxyQuest\Schema\GalaxySchema::assertGlossaryCache($db);
}

?>
