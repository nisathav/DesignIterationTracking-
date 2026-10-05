// Ordered schema migrations. Each entry runs once; PRAGMA user_version records
// how many have been applied. Never edit a released migration, add a new one.

export const migrations: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id                    INTEGER PRIMARY KEY,
    name                  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email                 TEXT,
    role                  TEXT    NOT NULL CHECK (role IN ('manager','designer')),
    password_hash         TEXT,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    active                INTEGER NOT NULL DEFAULT 1,
    feed_seen_at          TEXT,
    created_at            TEXT    NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE domains (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 3 AND code = upper(code)),
    name        TEXT    NOT NULL,
    owner_id    INTEGER REFERENCES users(id),
    colour      TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE subsystems (
    id          INTEGER PRIMARY KEY,
    domain_id   INTEGER NOT NULL REFERENCES domains(id),
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    version     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (domain_id, name)
  );

  -- Editable dropdown values. 'behaviour' is the fixed meaning the app's rules
  -- rely on (e.g. any iteration status with behaviour 'closed' is read-only).
  CREATE TABLE lookup_values (
    id          INTEGER PRIMARY KEY,
    category    TEXT    NOT NULL CHECK (category IN
                  ('verdict','iteration_status','flag_status','flag_type','consideration_status')),
    label       TEXT    NOT NULL,
    behaviour   TEXT    NOT NULL,
    colour      TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_default  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    version     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (category, label)
  );

  -- Running numbers per scope ('C:SH', 'I:SH-C01', 'F:SH-C01-I03'). Only ever incremented.
  CREATE TABLE counters (
    scope  TEXT PRIMARY KEY,
    value  INTEGER NOT NULL
  );

  CREATE TABLE considerations (
    id              TEXT    PRIMARY KEY,
    seq             INTEGER NOT NULL,
    domain_id       INTEGER NOT NULL REFERENCES domains(id),
    subsystem_id    INTEGER NOT NULL REFERENCES subsystems(id),
    title           TEXT    NOT NULL,
    target_metric   TEXT    NOT NULL DEFAULT '',
    owner_id        INTEGER NOT NULL REFERENCES users(id),
    origin_flag_id  TEXT    REFERENCES flags(id),
    status_id       INTEGER NOT NULL REFERENCES lookup_values(id),
    notes           TEXT    NOT NULL DEFAULT '',
    created_by      INTEGER NOT NULL REFERENCES users(id),
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (domain_id, seq)
  );
  CREATE INDEX considerations_origin ON considerations(origin_flag_id);

  CREATE TABLE iterations (
    id                   TEXT    PRIMARY KEY,
    consideration_id     TEXT    NOT NULL REFERENCES considerations(id),
    seq                  INTEGER NOT NULL,
    parent_iteration_id  TEXT    REFERENCES iterations(id),
    parent_flag_id       TEXT    REFERENCES flags(id),
    date                 TEXT    NOT NULL,
    author_id            INTEGER NOT NULL REFERENCES users(id),
    design_input         TEXT    NOT NULL DEFAULT '',
    cad_design           TEXT    NOT NULL DEFAULT '',
    analytical_results   TEXT    NOT NULL DEFAULT '',
    simulation_results   TEXT    NOT NULL DEFAULT '',
    evidence_link        TEXT    NOT NULL DEFAULT '',
    verdict_id           INTEGER REFERENCES lookup_values(id),
    status_id            INTEGER NOT NULL REFERENCES lookup_values(id),
    next_action          TEXT    NOT NULL DEFAULT '',
    created_by           INTEGER NOT NULL REFERENCES users(id),
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL,
    version              INTEGER NOT NULL DEFAULT 1,
    UNIQUE (consideration_id, seq),
    CHECK (parent_iteration_id IS NULL OR parent_flag_id IS NULL)
  );

  CREATE TABLE flags (
    id                          TEXT    PRIMARY KEY,
    iteration_id                TEXT    NOT NULL REFERENCES iterations(id),
    seq                         INTEGER NOT NULL,
    raised_by_id                INTEGER NOT NULL REFERENCES users(id),
    date_raised                 TEXT    NOT NULL,
    type_id                     INTEGER NOT NULL REFERENCES lookup_values(id),
    assigned_to_id              INTEGER NOT NULL REFERENCES users(id),
    affected_domain_id          INTEGER NOT NULL REFERENCES domains(id),
    request                     TEXT    NOT NULL,
    due_date                    TEXT,
    status_id                   INTEGER NOT NULL REFERENCES lookup_values(id),
    response                    TEXT    NOT NULL DEFAULT '',
    resulting_consideration_id  TEXT    REFERENCES considerations(id),
    date_closed                 TEXT,
    created_at                  TEXT    NOT NULL,
    updated_at                  TEXT    NOT NULL,
    version                     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (iteration_id, seq)
  );
  CREATE INDEX flags_assignee ON flags(assigned_to_id);
  CREATE INDEX flags_raiser ON flags(raised_by_id);

  CREATE TABLE comments (
    id           INTEGER PRIMARY KEY,
    entity_type  TEXT    NOT NULL CHECK (entity_type IN ('consideration','iteration','flag')),
    entity_id    TEXT    NOT NULL,
    author_id    INTEGER NOT NULL REFERENCES users(id),
    body         TEXT    NOT NULL,
    created_at   TEXT    NOT NULL
  );
  CREATE INDEX comments_entity ON comments(entity_type, entity_id);

  CREATE TABLE attachments (
    id           INTEGER PRIMARY KEY,
    entity_type  TEXT    NOT NULL CHECK (entity_type IN ('consideration','iteration','flag')),
    entity_id    TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('file','link')),
    label        TEXT    NOT NULL,
    url          TEXT,
    stored_name  TEXT,
    mime         TEXT,
    size         INTEGER,
    uploaded_by  INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT    NOT NULL,
    withdrawn    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX attachments_entity ON attachments(entity_type, entity_id);

  CREATE TABLE follows (
    user_id      INTEGER NOT NULL REFERENCES users(id),
    entity_type  TEXT    NOT NULL CHECK (entity_type IN ('consideration','domain')),
    entity_id    TEXT    NOT NULL,
    created_at   TEXT    NOT NULL,
    PRIMARY KEY (user_id, entity_type, entity_id)
  );
  CREATE INDEX follows_entity ON follows(entity_type, entity_id);

  CREATE TABLE notifications (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    kind         TEXT    NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL
  );
  CREATE INDEX notifications_user ON notifications(user_id, is_read);

  -- Every change, one row per field. Rows with an 'event' value make up the activity feed.
  CREATE TABLE audit_log (
    id           INTEGER PRIMARY KEY,
    batch_id     TEXT    NOT NULL,
    at           TEXT    NOT NULL,
    user_id      INTEGER REFERENCES users(id),
    action       TEXT    NOT NULL,
    entity_type  TEXT    NOT NULL,
    entity_id    TEXT    NOT NULL,
    domain_id    INTEGER REFERENCES domains(id),
    consideration_id TEXT,
    field        TEXT,
    old_value    TEXT,
    new_value    TEXT,
    event        TEXT
  );
  CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);
  CREATE INDEX audit_event ON audit_log(event, id);
  `,
  /* 2: review outcomes, manager escalation, close override */ `
  ALTER TABLE flags ADD COLUMN review_outcome TEXT
    CHECK (review_outcome IN ('approved','approved_with_comments','changes_needed'));
  ALTER TABLE flags ADD COLUMN review_outcome_by INTEGER REFERENCES users(id);
  ALTER TABLE flags ADD COLUMN review_outcome_at TEXT;
  ALTER TABLE flags ADD COLUMN escalated_at TEXT;
  ALTER TABLE flags ADD COLUMN escalated_by INTEGER REFERENCES users(id);
  ALTER TABLE flags ADD COLUMN escalation_reason TEXT;
  ALTER TABLE flags ADD COLUMN escalation_resolved_at TEXT;
  ALTER TABLE flags ADD COLUMN escalation_resolved_by INTEGER REFERENCES users(id);
  ALTER TABLE flags ADD COLUMN escalation_resolution TEXT;
  -- Set when managers were told the flag is overdue, so they are told once.
  ALTER TABLE flags ADD COLUMN overdue_escalated_at TEXT;
  -- Why a manager closed an iteration without all reviews approved.
  ALTER TABLE iterations ADD COLUMN close_override_reason TEXT;
  `,
];
