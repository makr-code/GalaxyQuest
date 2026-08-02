#!/usr/bin/env php
<?php
/**
 * TEST: Ship Component Prompt Library
 * Quick validation of all prompts before TRELLIS2 deployment
 * 
 * Usage:
 *   php tools/test_prompt_library.php
 *   php tools/test_prompt_library.php vor_tak
 *   php tools/test_prompt_library.php syl_nar weapons medium
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/ship_component_prompts.php';

// ────────────────────────────────────────────────────────────────────────────

const FACTIONS = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
const COMPONENTS = ['weapons', 'engines', 'shields', 'sensors'];
const SIZES = ['small', 'medium', 'large'];

// Colors for terminal output
const COLOR_GREEN = "\033[0;32m";
const COLOR_BLUE = "\033[0;34m";
const COLOR_YELLOW = "\033[1;33m";
const COLOR_RED = "\033[0;31m";
const COLOR_RESET = "\033[0m";

// ────────────────────────────────────────────────────────────────────────────

function print_header(string $text): void {
    echo COLOR_BLUE . "\n" . str_repeat("═", strlen($text)) . COLOR_RESET . "\n";
    echo COLOR_BLUE . $text . COLOR_RESET . "\n";
    echo COLOR_BLUE . str_repeat("═", strlen($text)) . COLOR_RESET . "\n\n";
}

function print_success(string $text): void {
    echo COLOR_GREEN . "✓ " . $text . COLOR_RESET . "\n";
}

function print_error(string $text): void {
    echo COLOR_RED . "✗ " . $text . COLOR_RESET . "\n";
}

function print_info(string $text): void {
    echo COLOR_YELLOW . "ℹ " . $text . COLOR_RESET . "\n";
}

function validate_prompt(string $prompt): bool {
    // Check for required sections
    if (empty(trim($prompt))) {
        print_error("Empty prompt");
        return false;
    }
    
    if (strlen($prompt) < 100) {
        print_error("Prompt too short (" . strlen($prompt) . " chars)");
        return false;
    }
    
    // Check for missing critical keywords
    $keywords = ['generation', 'polygon', 'triangle', 'material', 'color'];
    $has_keywords = false;
    
    foreach ($keywords as $keyword) {
        if (stripos($prompt, $keyword) !== false) {
            $has_keywords = true;
            break;
        }
    }
    
    if (!$has_keywords) {
        print_error("Missing critical keywords (polygon budget, material, color)");
        return false;
    }
    
    return true;
}

// ────────────────────────────────────────────────────────────────────────────

// COMMAND LINE HANDLING

$faction = $argv[1] ?? null;
$component = $argv[2] ?? null;
$size = $argv[3] ?? null;

// Show usage
if ($faction === '--help' || $faction === '-h') {
    echo <<<USAGE

SHIP COMPONENT PROMPT LIBRARY – Test Utility
═════════════════════════════════════════════

Usage: php tools/test_prompt_library.php [FACTION] [COMPONENT] [SIZE]

EXAMPLES:

  # Test all prompts
  php tools/test_prompt_library.php

  # Test specific faction
  php tools/test_prompt_library.php vor_tak

  # Test specific component
  php tools/test_prompt_library.php vor_tak weapons medium

  # Test geometry reference
  php tools/test_prompt_library.php vor_tak --geometry

FACTIONS:  vor_tak, syl_nar, aereth, kryl_tha, zhareen, vel_ar
COMPONENTS: weapons, engines, shields, sensors
SIZES:     small, medium, large

USAGE;
    exit(0);
}

print_header("SHIP COMPONENT PROMPT LIBRARY – Test Suite");

// ────────────────────────────────────────────────────────────────────────────

if ($faction === '--all' || $faction === null) {
    // Test ALL prompts
    print_info("Testing all faction + component combinations...\n");
    
    $total_tests = 0;
    $passed_tests = 0;
    
    foreach (FACTIONS as $f) {
        echo COLOR_YELLOW . "\nFaction: $f" . COLOR_RESET . "\n";
        
        // Test hull
        try {
            $hull_prompt = ShipComponentPromptLibrary::getHullPrompt($f);
            $total_tests++;
            if (validate_prompt($hull_prompt)) {
                print_success("Hull prompt ($f)");
                $passed_tests++;
            }
        } catch (Exception $e) {
            print_error("Hull prompt ($f): " . $e->getMessage());
            $total_tests++;
        }
        
        // Test components
        foreach (COMPONENTS as $comp) {
            foreach (SIZES as $sz) {
                try {
                    $prompt = ShipComponentPromptLibrary::getComponentPrompt($comp, $f, $sz);
                    $total_tests++;
                    if (validate_prompt($prompt)) {
                        print_success("  $comp/$sz");
                        $passed_tests++;
                    }
                } catch (Exception $e) {
                    print_error("  $comp/$sz: " . $e->getMessage());
                    $total_tests++;
                }
            }
        }
        
        // Test geometry reference
        try {
            $geom = ShipComponentPromptLibrary::getGeometryReference($f);
            $total_tests++;
            if (!empty($geom)) {
                print_success("Geometry reference");
                $passed_tests++;
            } else {
                print_error("Empty geometry reference");
            }
        } catch (Exception $e) {
            print_error("Geometry reference: " . $e->getMessage());
            $total_tests++;
        }
        
        // Test texture reference
        try {
            $tex = ShipComponentPromptLibrary::getTextureReference($f);
            $total_tests++;
            if (!empty($tex)) {
                print_success("Texture reference");
                $passed_tests++;
            } else {
                print_error("Empty texture reference");
            }
        } catch (Exception $e) {
            print_error("Texture reference: " . $e->getMessage());
            $total_tests++;
        }
    }
    
    echo "\n" . COLOR_BLUE . str_repeat("─", 50) . COLOR_RESET . "\n";
    echo COLOR_GREEN . "RESULTS: $passed_tests / $total_tests tests passed" . COLOR_RESET . "\n";
    
    if ($passed_tests === $total_tests) {
        echo COLOR_GREEN . "✓ All tests PASSED!" . COLOR_RESET . "\n";
        exit(0);
    } else {
        echo COLOR_RED . "✗ Some tests FAILED!" . COLOR_RESET . "\n";
        exit(1);
    }
}

// ────────────────────────────────────────────────────────────────────────────

// Test specific faction
if (!in_array($faction, FACTIONS)) {
    print_error("Unknown faction: $faction");
    echo "Available: " . implode(", ", FACTIONS) . "\n";
    exit(1);
}

print_info("Testing faction: $faction\n");

// Test hull
try {
    echo "\n" . COLOR_BLUE . "HULL PROMPT:" . COLOR_RESET . "\n";
    echo str_repeat("─", 50) . "\n";
    
    $hull_prompt = ShipComponentPromptLibrary::getHullPrompt($faction);
    
    echo substr($hull_prompt, 0, 500);
    echo "\n... [truncated]\n\n";
    
    echo "Length: " . strlen($hull_prompt) . " chars\n";
    
    if (validate_prompt($hull_prompt)) {
        print_success("Hull prompt is valid");
    } else {
        print_error("Hull prompt validation failed");
    }
} catch (Exception $e) {
    print_error("Hull prompt error: " . $e->getMessage());
    exit(1);
}

// Test components if specified
if ($component && in_array($component, COMPONENTS)) {
    if (!$size) {
        $size = 'medium';
    }
    
    if (!in_array($size, SIZES)) {
        print_error("Unknown size: $size (available: " . implode(", ", SIZES) . ")");
        exit(1);
    }
    
    try {
        echo "\n" . COLOR_BLUE . "COMPONENT PROMPT: $component ($size)" . COLOR_RESET . "\n";
        echo str_repeat("─", 50) . "\n";
        
        $prompt = ShipComponentPromptLibrary::getComponentPrompt($component, $faction, $size);
        
        echo substr($prompt, 0, 500);
        echo "\n... [truncated]\n\n";
        
        echo "Length: " . strlen($prompt) . " chars\n";
        
        if (validate_prompt($prompt)) {
            print_success("Component prompt is valid");
        } else {
            print_error("Component prompt validation failed");
        }
    } catch (Exception $e) {
        print_error("Component prompt error: " . $e->getMessage());
        exit(1);
    }
}

// Test reference data
try {
    echo "\n" . COLOR_BLUE . "GEOMETRY REFERENCE:" . COLOR_RESET . "\n";
    echo str_repeat("─", 50) . "\n";
    
    $geom = ShipComponentPromptLibrary::getGeometryReference($faction);
    
    if (is_array($geom) && !empty($geom)) {
        print_success("Geometry reference loaded (" . count($geom) . " specs)");
        
        // Show first spec
        $first_key = array_key_first($geom);
        if ($first_key) {
            echo "Example key: $first_key\n";
        }
    } else {
        print_error("Geometry reference is empty or invalid");
    }
} catch (Exception $e) {
    print_error("Geometry reference error: " . $e->getMessage());
}

echo "\n";
print_success("Test completed successfully");
exit(0);
