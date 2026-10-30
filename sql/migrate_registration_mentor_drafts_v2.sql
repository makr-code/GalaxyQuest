ALTER TABLE registration_drafts
    DROP INDEX uniq_registration_session,
    ADD COLUMN mentor_code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER session_hash,
    ADD COLUMN selected_session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER mentor_code;

UPDATE registration_drafts
SET mentor_code = COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.anchor_species')),
        JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.faction_code')),
        'legacy'
    ),
    selected_session_hash = session_hash;

ALTER TABLE registration_drafts
    MODIFY COLUMN mentor_code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ADD UNIQUE KEY uniq_registration_session_mentor (session_hash, mentor_code),
    ADD UNIQUE KEY uniq_registration_selected_session (selected_session_hash);