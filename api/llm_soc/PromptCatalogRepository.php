<?php

declare(strict_types=1);

final class PromptCatalogRepository {
    private string $jsonPath;

    public function __construct(?string $jsonPath = null) {
        $this->jsonPath = $jsonPath ?: __DIR__ . '/../../config/llm_profiles.json';
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function loadFileProfiles(): array {
        if (!is_file($this->jsonPath)) {
            return [];
        }

        $raw = file_get_contents($this->jsonPath);
        if ($raw === false) {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [];
        }

        $profiles = $decoded['profiles'] ?? null;
        if (!is_array($profiles)) {
            return [];
        }

        $out = [];
        foreach ($profiles as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $key = strtolower(trim((string) ($entry['key'] ?? '')));
            $name = trim((string) ($entry['name'] ?? ''));
            $systemPrompt = trim((string) ($entry['system_prompt'] ?? ''));
            $userTemplate = trim((string) ($entry['user_template'] ?? ''));

            if ($key === '' || $name === '' || $systemPrompt === '' || $userTemplate === '') {
                continue;
            }

            $out[] = [
                'profile_key' => $key,
                'name' => $name,
                'description' => trim((string) ($entry['description'] ?? '')),
                'system_prompt' => $systemPrompt,
                'user_template' => $userTemplate,
                'input_schema_json' => is_array($entry['input_schema'] ?? null)
                    ? $entry['input_schema']
                    : [],
                'source' => 'json',
            ];
        }

        return $out;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function loadDbProfiles(PDO $db): array {
        $sql = <<<'SQL'
SELECT
    profile_key,
    name,
    description,
    system_prompt,
    user_template,
    input_schema_json,
    source
FROM llm_prompt_profiles
WHERE active = 1
ORDER BY profile_key ASC
SQL;

        try {
            $stmt = $db->query($sql);
            if (!$stmt) {
                return [];
            }
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $e) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $key = strtolower(trim((string) ($row['profile_key'] ?? '')));
            if ($key === '') {
                continue;
            }

            $schemaRaw = $row['input_schema_json'] ?? null;
            $schema = [];
            if (is_string($schemaRaw) && $schemaRaw !== '') {
                $decoded = json_decode($schemaRaw, true);
                if (is_array($decoded)) {
                    $schema = $decoded;
                }
            } elseif (is_array($schemaRaw)) {
                $schema = $schemaRaw;
            }

            $out[] = [
                'profile_key' => $key,
                'name' => trim((string) ($row['name'] ?? '')),
                'description' => trim((string) ($row['description'] ?? '')),
                'system_prompt' => trim((string) ($row['system_prompt'] ?? '')),
                'user_template' => trim((string) ($row['user_template'] ?? '')),
                'input_schema_json' => $schema,
                'source' => trim((string) ($row['source'] ?? 'db')),
            ];
        }

        return $out;
    }
}
