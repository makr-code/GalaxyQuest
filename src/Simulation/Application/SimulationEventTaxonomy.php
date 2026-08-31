<?php

declare(strict_types=1);

namespace GalaxyQuest\Simulation\Application;

final class SimulationEventTaxonomy
{
    /**
     * @return array{version:string,events:array<int,array{key:string,scope:string,category:string}>}
     */
    public static function load(string $filePath): array
    {
        if (!is_file($filePath)) {
            throw new \RuntimeException("Simulation event taxonomy file not found: {$filePath}");
        }

        $raw = file_get_contents($filePath);
        if ($raw === false) {
            throw new \RuntimeException("Unable to read simulation event taxonomy file: {$filePath}");
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException("Invalid simulation event taxonomy JSON: {$filePath}");
        }

        $version = trim((string)($decoded['version'] ?? ''));
        $events = is_array($decoded['events'] ?? null) ? $decoded['events'] : [];
        if ($version === '' || $events === []) {
            throw new \RuntimeException("Simulation event taxonomy missing required fields: {$filePath}");
        }

        $normalizedEvents = [];
        $seen = [];
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $key = trim((string)($event['key'] ?? ''));
            $scope = trim((string)($event['scope'] ?? ''));
            $category = trim((string)($event['category'] ?? ''));
            if ($key === '' || $scope === '' || $category === '') {
                continue;
            }
            if (isset($seen[$key])) {
                throw new \RuntimeException("Duplicate simulation event key in taxonomy: {$key}");
            }
            $seen[$key] = true;
            $normalizedEvents[] = [
                'key' => $key,
                'scope' => $scope,
                'category' => $category,
            ];
        }

        if ($normalizedEvents === []) {
            throw new \RuntimeException("Simulation event taxonomy has no valid events: {$filePath}");
        }

        return [
            'version' => $version,
            'events' => $normalizedEvents,
        ];
    }
}

