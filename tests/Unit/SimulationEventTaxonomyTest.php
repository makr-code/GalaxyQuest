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
        $this->assertSame('tick.global.started', $taxonomy['events'][0]['key']);
    }

    public function testLoadThrowsForMissingFile(): void
    {
        $this->expectException(RuntimeException::class);
        SimulationEventTaxonomy::load(dirname(__DIR__, 2) . '/config/does-not-exist.json');
    }
}

