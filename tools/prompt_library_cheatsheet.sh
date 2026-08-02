#!/usr/bin/env bash
# Quick Reference: Ship Component Prompts
# File: tools/prompt_library_cheatsheet.sh

set -e

API_URL="${API_URL:-http://localhost:8080}"
ENDPOINT="$API_URL/api/ship_component_prompts.php"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─────────────────────────────────────────────────────────────────────────

show_help() {
    cat << 'EOF'
SHIP COMPONENT PROMPT LIBRARY – Quick Reference
════════════════════════════════════════════════

Usage: ./tools/prompt_library_cheatsheet.sh [COMMAND] [OPTIONS]

COMMANDS:

  get-hull-prompt FACTION_CODE
    Get full hull prompt (geometry + texture + assembly)
    Example: get-hull-prompt vor_tak
    Output: Complete prompt text for TRELLIS2

  get-component-prompt COMPONENT SIZE FACTION_CODE
    Get component-specific prompt
    Components: weapons | engines | shields | sensors
    Sizes: small | medium | large
    Example: get-component-prompt weapons medium vor_tak

  get-geometry-specs FACTION_CODE
    Get all geometry specifications as reference
    Example: get-geometry-specs syl_nar

  get-texture-specs FACTION_CODE
    Get all texture specifications as reference
    Example: get-texture-specs vor_tak

  list-all
    List all factions and components

EXAMPLES:

  # Get Vor'Tak hull prompt
  ./tools/prompt_library_cheatsheet.sh get-hull-prompt vor_tak

  # Get medium weapon prompt for Syl'Nar
  ./tools/prompt_library_cheatsheet.sh get-component-prompt weapons medium syl_nar

  # Get all engine specifications
  ./tools/prompt_library_cheatsheet.sh get-geometry-specs vor_tak | grep -A 50 "ENGINES"

  # Save prompt to file
  ./tools/prompt_library_cheatsheet.sh get-hull-prompt vor_tak > hull_vor_tak.txt

FACTIONS:
  vor_tak   – Angular, armored, dark bronze (military aesthetic)
  syl_nar   – Flowing curves, bioluminescent blue (organic aesthetic)
  aereth    – Elegant, wind-like curves, green accents
  kryl_tha  – Crystalline, geometric, gold accents
  zhareen   – Magical, ethereal, purple bioluminescence
  vel_ar    – Sleek, dark, silver accents

COMPONENTS:
  hull      – Main ship form (5000-5500 triangles)
  weapons   – Weapon hardpoints (small/medium/large)
  engines   – Thruster modules (dual mount)
  shields   – Shield generators (defense nodes)
  sensors   – Sensor arrays (scanning pod)

POLYGON BUDGETS:
  Hull:     4000-5500 triangles
  Weapons:  200-700 triangles each
  Engines:  1000-1400 triangles each (dual)
  Shields:  600 triangles
  Sensors:  800 triangles
  TOTAL:    ~10,100 triangles (game-optimized)

PBR MAP REFERENCE:
  Albedo    – Base color (RGB values)
  Metallic  – 0.0 (non-metal) to 1.0 (pure metal)
  Roughness – 0.0 (mirror) to 1.0 (rough)
  Normal    – Faux-geometry details (Nm depth)
  Emission  – Self-illumination (for glow effects)

EOF
    exit 0
}

# ─────────────────────────────────────────────────────────────────────────

# Helper function to fetch from API
fetch_prompt() {
    local action=$1
    local query=$2
    
    echo -e "${BLUE}[Fetching] $action...${NC}" >&2
    
    local response=$(curl -s "$ENDPOINT?action=$action&$query")
    
    if echo "$response" | jq . &>/dev/null; then
        echo "$response" | jq -r '.prompt // .geometry_specs // .texture_specs // .'
    else
        echo -e "${YELLOW}Error: Invalid response${NC}" >&2
        echo "$response"
    fi
}

# ─────────────────────────────────────────────────────────────────────────

# Main commands
case "${1:-help}" in
    get-hull-prompt)
        FACTION="${2:-vor_tak}"
        fetch_prompt "get_hull_prompt" "faction_code=$FACTION"
        ;;
    
    get-component-prompt)
        COMPONENT="${2:-weapons}"
        SIZE="${3:-medium}"
        FACTION="${4:-vor_tak}"
        fetch_prompt "get_component_prompt" "component=$COMPONENT&faction_code=$FACTION&size=$SIZE"
        ;;
    
    get-geometry-specs)
        FACTION="${2:-vor_tak}"
        fetch_prompt "get_geometry_reference" "faction_code=$FACTION" | jq '.'
        ;;
    
    get-texture-specs)
        FACTION="${2:-vor_tak}"
        fetch_prompt "get_texture_reference" "faction_code=$FACTION" | jq '.'
        ;;
    
    list-all)
        echo -e "${GREEN}Available Factions:${NC}"
        echo "  vor_tak, syl_nar, aereth, kryl_tha, zhareen, vel_ar"
        echo ""
        echo -e "${GREEN}Available Components:${NC}"
        echo "  hull, weapons, engines, shields, sensors"
        echo ""
        echo -e "${GREEN}Available Sizes:${NC}"
        echo "  small, medium, large"
        echo ""
        echo -e "${GREEN}Example Usage:${NC}"
        echo "  ./tools/prompt_library_cheatsheet.sh get-hull-prompt vor_tak"
        echo "  ./tools/prompt_library_cheatsheet.sh get-component-prompt engines large syl_nar"
        ;;
    
    help|--help|-h)
        show_help
        ;;
    
    *)
        echo -e "${YELLOW}Unknown command: $1${NC}"
        echo "Use: $0 help"
        exit 1
        ;;
esac
