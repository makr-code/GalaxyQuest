-- Migration: Add geometry storage for wireframe editor
-- This enables the wireframe editor to save vertices, edges, faces to vessel_designs

ALTER TABLE vessel_designs ADD COLUMN IF NOT EXISTS geometry_data LONGTEXT COMMENT 'JSON: {vertices: [...], edges: [...], faces: [...]}';
ALTER TABLE vessel_designs ADD COLUMN IF NOT EXISTS wireframe_source VARCHAR(20) DEFAULT 'manual' COMMENT 'manual|generated|imported';

-- Update existing vessel_designs to mark them as "manual" source
UPDATE vessel_designs SET wireframe_source = 'manual' WHERE wireframe_source IS NULL;

-- Create index for faster lookups
ALTER TABLE vessel_designs ADD INDEX IF NOT EXISTS idx_user_wireframe (user_id, wireframe_source);
