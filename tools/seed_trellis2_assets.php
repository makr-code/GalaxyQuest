#!/usr/bin/env php
<?php
/**
 * TRELLIS2 Seed Base Assets
 * 
 * Generates canonical base components and avatars for all factions/species
 * 
 * Usage: php tools/seed_trellis2_assets.php [--faction vor_tak] [--skip-avatars] [--no-wait]
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/cache.php';
require_once __DIR__ . '/../api/trellis2_generator.php';

// ────────────────────────────────────────────────────────────────────────────

class TRELLIS2Seeder {
    
    private PDO $db;
    private BaseShipComponentGenerator $componentGen;
    private SpeciesAvatarGenerator $avatarGen;
    private TRELLIS2Client $trellis2;
    private array $options;
    
    public function __construct(PDO $db, array $options = []) {
        $this->db = $db;
        $this->options = array_merge([
            'faction' => null,
            'skip-avatars' => false,
            'no-wait' => false,
            'wait-timeout' => 300,
        ], $options);
        
        $this->trellis2 = new TRELLIS2Client();
        $this->componentGen = new BaseShipComponentGenerator($db, $this->trellis2);
        $this->avatarGen = new SpeciesAvatarGenerator($db, $this->trellis2);
    }
    
    public function run(): void {
        echo "[TRELLIS2-Seeder] Starting base asset generation...\n";
        
        // Check TRELLIS2 health
        if (!$this->trellis2->healthCheck()) {
            echo "❌ TRELLIS2 container not responding!\n";
            echo "   Start it with: docker compose --profile ai-3d up trellis2\n";
            exit(1);
        }
        echo "✓ TRELLIS2 container healthy\n\n";
        
        $factions = $this->options['faction'] 
            ? [$this->options['faction']]
            : ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
        
        // Generate base ship components
        foreach ($factions as $faction) {
            $this->seedFactionComponents($faction);
        }
        
        // Generate species avatars
        if (!$this->options['skip-avatars']) {
            $species = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
            foreach ($species as $spec) {
                $this->seedSpeciesAvatars($spec);
            }
        }
        
        echo "\n✓ Seeding complete!\n";
    }
    
    private function seedFactionComponents(string $factionCode): void {
        echo "\n╔══════════════════════════════════════════════╗\n";
        echo "║  Generating Base Components: $factionCode\n";
        echo "╚══════════════════════════════════════════════╝\n";
        
        $components = [
            ['type' => 'hull', 'gen' => 'generateBaseHull'],
            ['type' => 'weapons', 'gen' => 'generateWeaponHardpoints'],
            ['type' => 'engines', 'gen' => 'generateEngineModules'],
            ['type' => 'shields', 'gen' => 'generateShieldModules'],
            ['type' => 'sensors', 'gen' => 'generateSensorArray'],
        ];
        
        $jobs = [];
        foreach ($components as $comp) {
            echo "\n→ Queuing {$comp['type']} generation...\n";
            $result = call_user_func([$this->componentGen, $comp['gen']], $factionCode);
            
            if ($result['success'] ?? false) {
                $jobId = $result['job_id'];
                $jobs[$comp['type']] = $jobId;
                echo "  ✓ Job queued: $jobId\n";
            } else {
                echo "  ❌ Failed: {$result['error']}\n";
            }
        }
        
        // Wait for jobs to complete (if not --no-wait)
        if (!$this->options['no-wait'] && !empty($jobs)) {
            $this->waitForJobs($factionCode, $jobs);
        }
    }
    
    private function seedSpeciesAvatars(string $speciesCode): void {
        echo "\n→ Generating avatars for $speciesCode...\n";
        
        $result = $this->avatarGen->generateSpeciesAvatar($speciesCode, 'both');
        
        foreach ($result as $gender => $res) {
            if ($res['success'] ?? false) {
                echo "  ✓ {$gender}: {$res['job_id']}\n";
            } else {
                echo "  ❌ {$gender}: {$res['error']}\n";
            }
        }
    }
    
    private function waitForJobs(string $factionCode, array $jobs): void {
        echo "\n⏳ Waiting for generation to complete (timeout: {$this->options['wait-timeout']}s)...\n\n";
        
        $timeout = time() + $this->options['wait-timeout'];
        $completed = [];
        
        while (count($completed) < count($jobs) && time() < $timeout) {
            foreach ($jobs as $type => $jobId) {
                if (isset($completed[$type])) {
                    continue;
                }
                
                $status = $this->trellis2->getJobStatus($jobId);
                $currentStatus = $status['status'] ?? 'unknown';
                $progress = $status['progress'] ?? 0;
                
                if ($currentStatus === 'done') {
                    echo "✓ $type: COMPLETE\n";
                    $completed[$type] = true;
                } else if ($currentStatus === 'error' || $currentStatus === 'failed') {
                    echo "❌ $type: FAILED ({$status['error'] ?? 'unknown error'})\n";
                    $completed[$type] = true;
                } else {
                    echo "  $type: $currentStatus ({$progress}%)\r";
                }
            }
            
            if (count($completed) < count($jobs)) {
                sleep(3);
            }
        }
        
        echo "\n";
        
        if (count($completed) < count($jobs)) {
            echo "⚠ Some jobs timed out\n";
        }
        
        // Finalize completed jobs
        foreach ($completed as $type => $done) {
            if ($done) {
                $jobId = $jobs[$type];
                $finalized = $this->componentGen->finalizeJob($jobId);
                if ($finalized['complete'] ?? false) {
                    echo "  → $type stored: {$finalized['glb_path']}\n";
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────

// Parse command-line options
$options = [];
foreach ($argv as $arg) {
    if ($arg === '--skip-avatars') {
        $options['skip-avatars'] = true;
    } elseif ($arg === '--no-wait') {
        $options['no-wait'] = true;
    } elseif (str_starts_with($arg, '--faction=')) {
        $options['faction'] = substr($arg, strlen('--faction='));
    } elseif (str_starts_with($arg, '--faction')) {
        $idx = array_search($arg, $argv);
        if (isset($argv[$idx + 1])) {
            $options['faction'] = $argv[$idx + 1];
        }
    }
}

// Run seeder
try {
    $db = get_db();
    $seeder = new TRELLIS2Seeder($db, $options);
    $seeder->run();
} catch (\Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
    exit(1);
}
?>
