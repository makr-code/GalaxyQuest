<?php

declare(strict_types=1);

final class BodyResourceProfile
{
    public const VERSION = 1;
    public const MINERALS = ['metal', 'crystal', 'deuterium', 'rare_earth'];

    /**
     * Generated estimates are not live inventories. Legacy values, when supplied,
     * are the current remaining deposits, not the original geological quantities.
     */
    public static function build(array $body, array $estimates, ?array $legacy = null): array
    {
        $type = (string)($body['body_type'] ?? 'planet');
        $class = (string)($body['planet_class'] ?? '');
        $gas = in_array($class, ['gas_giant', 'ice_giant', 'hot_jupiter'], true);
        $sources = [];

        foreach (self::MINERALS as $resource) {
            $key = 'deposit_' . $resource;
            $values = $legacy ?? $estimates;
            if (!array_key_exists($key, $values)) {
                continue;
            }
            $quantity = self::number($values[$key], $key);
            if ($quantity < 0 && $quantity !== -1.0) {
                throw new InvalidArgumentException('Invalid deposit: ' . $key);
            }
            $quality = self::number($values['richness_' . $resource] ?? 1, 'richness_' . $resource);
            if ($quality < 0) {
                throw new InvalidArgumentException('Resource richness cannot be negative.');
            }
            $method = $type === 'ring_system' ? 'orbital_mining' : 'surface_mining';
            if ($gas) {
                $method = $resource === 'deuterium' ? 'atmospheric_extraction' : 'deep_core_mining';
            }
            $sources[$resource] = [
                'source_type' => $quantity === -1.0 ? 'unlimited' : 'finite',
                'initial_quantity' => $quantity === -1.0 || $legacy !== null ? null : $quantity,
                'remaining_quantity' => $quantity === -1.0 ? null : $quantity,
                'capacity' => null,
                'regeneration_per_hour' => 0.0,
                'richness' => $quality,
                'extraction_method' => $method,
                'origin' => $legacy === null ? 'generated' : 'legacy_snapshot',
            ];
        }

        // A gameplay biosphere is only assigned where local surface data supports it.
        // Habitability alone (especially that of the parent planet) is not sufficient.
        $temperature = self::number($body['eq_temp_k'] ?? 0, 'eq_temp_k');
        $habitability = self::number($body['habitability_score'] ?? 0, 'habitability_score');
        if (
            in_array($type, ['planet', 'moon'], true)
            && !$gas
            && ($body['water_state'] ?? '') === 'liquid'
            && ($body['atmosphere_type'] ?? '') === 'nitrogen_oxygen'
            && $habitability >= 65
            && $temperature >= 240
            && $temperature <= 330
            && isset($body['mass_earth'])
        ) {
            $mass = self::number($body['mass_earth'], 'mass_earth');
            if ($mass <= 0) {
                throw new InvalidArgumentException('Body mass must be positive.');
            }
            $capacity = round(10000 * max(0.001, min(3.0, $mass)), 6);
            $sources['biomass'] = [
                'source_type' => 'regenerating',
                'initial_quantity' => $capacity,
                'remaining_quantity' => $capacity,
                'capacity' => $capacity,
                'regeneration_per_hour' => round($capacity * 0.001, 6),
                'richness' => 1.0,
                'extraction_method' => 'biosphere_harvesting',
                'origin' => 'generated',
            ];
        }

        return [
            'version' => self::VERSION,
            'assessment' => $sources === [] ? 'unassessed' : 'estimated',
            'sources' => $sources,
        ];
    }

    private static function number(mixed $value, string $field): float
    {
        if (!is_numeric($value) || !is_finite((float)$value)) {
            throw new InvalidArgumentException('Invalid resource number: ' . $field);
        }
        return (float)$value;
    }
}
