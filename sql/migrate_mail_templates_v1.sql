ALTER TABLE mail_outbox
    ADD COLUMN body_html MEDIUMTEXT NULL,
    ADD COLUMN template_id BIGINT UNSIGNED NULL,
    ADD COLUMN template_revision CHAR(64) NULL;
