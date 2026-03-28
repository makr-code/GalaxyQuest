<?php

declare(strict_types=1);

final class LlmPromptService {
    private PromptCatalogRepository $catalogRepository;

    public function __construct(PromptCatalogRepository $catalogRepository) {
        $this->catalogRepository = $catalogRepository;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function catalog(PDO $db): array {
        $fromFile = $this->catalogRepository->loadFileProfiles();
        $fromDb = $this->catalogRepository->loadDbProfiles($db);

        // DB overrides file profiles with same key.
        $byKey = [];
        foreach ($fromFile as $profile) {
            $byKey[(string) $profile['profile_key']] = $profile;
        }
        foreach ($fromDb as $profile) {
            $byKey[(string) $profile['profile_key']] = $profile;
        }

        ksort($byKey);

        $catalog = [];
        foreach ($byKey as $profile) {
            $catalog[] = [
                'profile_key' => $profile['profile_key'],
                'name' => $profile['name'],
                'description' => $profile['description'],
                'input_schema' => $profile['input_schema_json'],
                'source' => $profile['source'],
            ];
        }

        return $catalog;
    }

    /**
     * @param array<string, mixed> $inputVars
     * @return array<string, mixed>
     */
    public function compose(PDO $db, string $profileKey, array $inputVars): array {
        $profile = $this->findProfile($db, $profileKey);
        if ($profile === null) {
            return [
                'ok' => false,
                'error' => 'Unknown prompt profile.',
                'status' => 404,
            ];
        }

        $resolved = $this->renderTemplate((string) $profile['user_template'], $inputVars);
        $missing = $resolved['missing'];
        if (!empty($missing)) {
            return [
                'ok' => false,
                'error' => 'Missing required input vars: ' . implode(', ', $missing),
                'status' => 422,
            ];
        }

        return [
            'ok' => true,
            'profile' => [
                'profile_key' => $profile['profile_key'],
                'name' => $profile['name'],
                'description' => $profile['description'],
                'source' => $profile['source'],
            ],
            'messages' => [
                ['role' => 'system', 'content' => (string) $profile['system_prompt']],
                ['role' => 'user', 'content' => $resolved['text']],
            ],
            'resolved_input' => $resolved['resolved'],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findProfile(PDO $db, string $profileKey): ?array {
        $needle = strtolower(trim($profileKey));
        if ($needle === '') {
            return null;
        }

        $fromFile = $this->catalogRepository->loadFileProfiles();
        $fromDb = $this->catalogRepository->loadDbProfiles($db);

        $byKey = [];
        foreach ($fromFile as $profile) {
            $byKey[(string) $profile['profile_key']] = $profile;
        }
        foreach ($fromDb as $profile) {
            $byKey[(string) $profile['profile_key']] = $profile;
        }

        return $byKey[$needle] ?? null;
    }

    /**
     * @param array<string, mixed> $inputVars
     * @return array{text:string,missing:array<int,string>,resolved:array<string,string>}
     */
    private function renderTemplate(string $template, array $inputVars): array {
        $text = $template;
        preg_match_all('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', $template, $matches);
        $tokens = array_values(array_unique($matches[1] ?? []));

        $missing = [];
        $resolved = [];

        foreach ($tokens as $token) {
            $raw = $inputVars[$token] ?? null;
            $value = trim((string) $raw);
            if ($value === '') {
                $missing[] = $token;
                continue;
            }
            $resolved[$token] = $value;
            $text = str_replace('{{' . $token . '}}', $value, $text);
            $text = preg_replace('/\{\{\s*' . preg_quote($token, '/') . '\s*\}\}/', $value, $text) ?? $text;
        }

        return [
            'text' => trim($text),
            'missing' => $missing,
            'resolved' => $resolved,
        ];
    }
}
