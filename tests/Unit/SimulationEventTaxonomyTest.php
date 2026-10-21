<?php

declare(strict_types=1);

use GalaxyQuest\Simulation\Application\SimulationEventTaxonomy;
use PHPUnit\Framework\TestCase;

final class SimulationEventTaxonomyTest extends TestCase
{
    public function testLoadCanonicalTaxonomyFromConfig(): void
    {
        $taxonomy = SimulationEventTaxonomy::load(
            dirname(__DIR__, 2) . '/config/simulation_event_taxonomy.json'
        );

        $this->assertSame('1.0.0', $taxonomy['version']);
        $this->assertNotEmpty($taxonomy['events']);
        $eventKeys = array_column($taxonomy['events'], 'key');
        $this->assertContains('tick.global.started', $eventKeys);
    }

    public function testLoadThrowsForMissingFile(): void
    {
        $this->expectException(RuntimeException::class);
        SimulationEventTaxonomy::load(dirname(__DIR__, 2) . '/config/does-not-exist.json');
    }
}
