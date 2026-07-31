<?php

declare(strict_types=1);

/**
 * NpcBehaviorScript
 *
 * A parser and evaluator for YAML-based behavior scripts that drive NPC decision-making.
 * Supports conditions, actions, fallbacks, and personality modifiers.
 *
 * Script Structure:
 *   behavior: "faction_daily_strategy"
 *   personality_key: "iron_fleet_aggressive"
 *   conditions:
 *     - type: "faction_standing_threshold"
 *       operator: ">="
 *       value: 10
 *     - type: "resource_available"
 *       resource: "credits"
 *       min_value: 1000
 *   actions:
 *     - type: "trade_offer" | "raid" | "diplomacy_shift" | "generate_quest" | "send_message"
 *       probability: 0.6
 *       target_scope: "player" | "faction" | "all"
 *       personality_modifier: "aggression_boost"
 *       params: {...}
 *   fallback: "none" | "random" | "llm"
 */
final class NpcBehaviorScript
{
    /** @var array<string, mixed> */
    private array $scriptData = [];
    
    private string $behavior = '';
    private string $personalityKey = '';
    
    /** @var array<array<string, mixed>> */
    private array $conditions = [];
    
    /** @var array<array<string, mixed>> */
    private array $actions = [];
    
    private string $fallback = 'none';

    /**
     * Parse YAML script content
     *
     * @param string $yaml YAML script content
     * @throws \RuntimeException on parse error
     */
    public function parse(string $yaml): self
    {
        // Use the MiniYamlParser if available, or manual parsing
        if (class_exists('MiniYamlParser')) {
            $parser = new MiniYamlParser();
            $this->scriptData = $parser->parse($yaml);
        } else {
            // Fallback: simple parsing
            $this->scriptData = $this->simpleParse($yaml);
        }

        $this->behavior = (string) ($this->scriptData['behavior'] ?? '');
        $this->personalityKey = (string) ($this->scriptData['personality_key'] ?? '');
        $this->conditions = (array) ($this->scriptData['conditions'] ?? []);
        $this->actions = (array) ($this->scriptData['actions'] ?? []);
        $this->fallback = (string) ($this->scriptData['fallback'] ?? 'none');

        if ($this->behavior === '') {
            throw new \RuntimeException('Behavior script missing required "behavior" field');
        }

        return $this;
    }

    /**
     * Evaluate all conditions and return true if all pass (AND logic)
     *
     * @param array<string, mixed> $context Context for evaluation (user_id, faction_id, player_resources, etc.)
     * @return bool
     */
    public function evaluateConditions(array $context): bool
    {
        if (empty($this->conditions)) {
            return true;
        }

        foreach ($this->conditions as $cond) {
            if (!$this->evaluateCondition($cond, $context)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Select a single action based on conditions and probability
     *
     * @param array<string, mixed> $context Context for evaluation
     * @param \Random|null $rng Optional seeded RNG
     * @return array<string, mixed>|null Selected action or null
     */
    public function selectAction(array $context, ?\Random $rng = null): ?array
    {
        if (empty($this->actions)) {
            return null;
        }

        $candidates = [];
        foreach ($this->actions as $action) {
            $prob = (float) ($action['probability'] ?? 1.0);
            if ($prob >= 1.0) {
                $candidates[] = $action;
                continue;
            }

            // Use RNG if available, else use mt_rand
            if ($rng !== null) {
                $roll = $rng->getFloat(0.0, 1.0, \Random\IntervalBoundary::ClosedOpen);
            } else {
                $roll = mt_rand() / mt_getrandmax();
            }

            if ($roll < $prob) {
                $candidates[] = $action;
            }
        }

        if (empty($candidates)) {
            return null;
        }

        // Return first matching action (or random if multiple)
        return $candidates[0];
    }

    /**
     * Apply personality modifiers to action parameters
     *
     * @param array<string, mixed> $action Action definition
     * @param array<string, float> $personality Personality traits (e.g., ['aggression' => 1.2])
     * @return array<string, mixed> Modified action
     */
    public function applyPersonalityModifiers(array $action, array $personality): array
    {
        $modifier = (string) ($action['personality_modifier'] ?? '');
        if ($modifier === '') {
            return $action;
        }

        $action['personality_applied'] = $modifier;

        // Apply modifier logic based on personality key
        if ($modifier === 'aggression_boost' && isset($personality['aggression'])) {
            if (isset($action['probability'])) {
                $action['probability'] = min(1.0, $action['probability'] * $personality['aggression']);
            }
            if (isset($action['params']['intensity'])) {
                $action['params']['intensity'] *= $personality['aggression'];
            }
        }

        return $action;
    }

    /**
     * Get behavior name
     */
    public function getBehavior(): string
    {
        return $this->behavior;
    }

    /**
     * Get personality key
     */
    public function getPersonalityKey(): string
    {
        return $this->personalityKey;
    }

    /**
     * Get fallback strategy
     */
    public function getFallback(): string
    {
        return $this->fallback;
    }

    /**
     * Get all raw actions
     *
     * @return array<array<string, mixed>>
     */
    public function getActions(): array
    {
        return $this->actions;
    }

    /**
     * Evaluate a single condition
     *
     * @param array<string, mixed> $cond Condition definition
     * @param array<string, mixed> $context Context for evaluation
     * @return bool
     */
    private function evaluateCondition(array $cond, array $context): bool
    {
        $type = (string) ($cond['type'] ?? '');

        return match ($type) {
            'faction_standing_threshold' => $this->evalStandingThreshold($cond, $context),
            'resource_available' => $this->evalResourceAvailable($cond, $context),
            'time_window' => $this->evalTimeWindow($cond, $context),
            'player_level' => $this->evalPlayerLevel($cond, $context),
            'random_chance' => $this->evalRandomChance($cond, $context),
            default => true, // Unknown conditions pass
        };
    }

    private function evalStandingThreshold(array $cond, array $context): bool
    {
        $standing = (int) ($context['faction_standing'] ?? 0);
        $threshold = (int) ($cond['value'] ?? 0);
        $operator = (string) ($cond['operator'] ?? '>=');

        return match ($operator) {
            '>=' => $standing >= $threshold,
            '>' => $standing > $threshold,
            '<=' => $standing <= $threshold,
            '<' => $standing < $threshold,
            '==' => $standing === $threshold,
            default => true,
        };
    }

    private function evalResourceAvailable(array $cond, array $context): bool
    {
        $resource = (string) ($cond['resource'] ?? '');
        $minValue = (int) ($cond['min_value'] ?? 0);
        $available = (int) ($context['resources'][$resource] ?? 0);

        return $available >= $minValue;
    }

    private function evalTimeWindow(array $cond, array $context): bool
    {
        $startHour = (int) ($cond['start_hour'] ?? 0);
        $endHour = (int) ($cond['end_hour'] ?? 23);
        $currentHour = (int) date('H');

        return $currentHour >= $startHour && $currentHour <= $endHour;
    }

    private function evalPlayerLevel(array $cond, array $context): bool
    {
        $minLevel = (int) ($cond['min_level'] ?? 0);
        $playerLevel = (int) ($context['player_level'] ?? 0);

        return $playerLevel >= $minLevel;
    }

    private function evalRandomChance(array $cond, array $context): bool
    {
        $chance = (float) ($cond['chance'] ?? 0.5);
        return (mt_rand() / mt_getrandmax()) < $chance;
    }

    /**
     * Simple YAML parser fallback (basic key-value only)
     *
     * @param string $yaml
     * @return array<string, mixed>
     */
    private function simpleParse(string $yaml): array
    {
        $result = [];
        $lines = explode("\n", $yaml);
        $currentArray = null;
        $arrayIndent = 0;

        foreach ($lines as $line) {
            $trimmed = trim($line);
            
            if ($trimmed === '' || $trimmed[0] === '#') {
                continue;
            }

            if (str_contains($trimmed, ':')) {
                [$key, $val] = explode(':', $trimmed, 2);
                $key = trim($key);
                $val = trim($val);

                if ($val === '' || $val[0] === '[' || $val[0] === '{') {
                    $result[$key] = [];
                    $currentArray = $key;
                } else {
                    $result[$key] = $this->parseValue($val);
                }
            } elseif ($trimmed[0] === '-' && $currentArray !== null) {
                $item = trim(substr($trimmed, 1));
                if (is_array($result[$currentArray])) {
                    $result[$currentArray][] = $this->parseValue($item);
                }
            }
        }

        return $result;
    }

    /**
     * Parse a scalar value
     */
    private function parseValue(string $val): mixed
    {
        $val = trim($val);

        if ($val === 'true' || $val === 'yes') {
            return true;
        }
        if ($val === 'false' || $val === 'no') {
            return false;
        }
        if ($val === 'null') {
            return null;
        }
        if (is_numeric($val)) {
            return str_contains($val, '.') ? (float) $val : (int) $val;
        }
        if (($val[0] === '"' || $val[0] === "'") && $val[-1] === $val[0]) {
            return substr($val, 1, -1);
        }

        return $val;
    }
}
