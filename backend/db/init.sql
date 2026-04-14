-- ============================================================
-- Rotorflight Analyzer — PostgreSQL schema
-- Runs once at first container start via docker-entrypoint-initdb.d
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Lookup tables
-- ============================================================

CREATE TABLE maneuver_types (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_custom   BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard maneuver types
INSERT INTO maneuver_types (name, is_custom, description) VALUES
    ('hover',           FALSE, 'Stationary hover'),
    ('forward_flight',  FALSE, 'Sustained forward flight'),
    ('pirouette',       FALSE, 'Continuous yaw rotation'),
    ('tick_tock',       FALSE, 'Alternating pitch stops'),
    ('piro_flip',       FALSE, 'Pirouette flip maneuver'),
    ('piro_pitch_pump', FALSE, 'Pitch pump during pirouette'),
    ('stationary_flip', FALSE, 'Flip without pirouette'),
    ('stationary_roll', FALSE, 'Roll without pirouette'),
    ('tic_toc_roll',    FALSE, 'Alternating roll stops'),
    ('funnels',         FALSE, 'Funnel pattern'),
    ('stall_turn',      FALSE, 'Stall turn maneuver'),
    ('collective_pitch_pump', FALSE, 'Collective pitch input test'),
    ('step_response',   FALSE, 'Commanded step for analysis'),
    ('general',         FALSE, 'General flight segment');


-- ============================================================
-- Flights
-- ============================================================

CREATE TABLE flights (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                 TEXT NOT NULL,
    craft_name           TEXT,
    flown_at             TIMESTAMPTZ,
    csv_filename         TEXT,
    csv_path             TEXT,
    total_loop_iterations BIGINT,
    sample_rate_hz       FLOAT,
    duration_s           FLOAT,
    firmware_version     TEXT,
    board_name           TEXT,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Config dumps
-- ============================================================

CREATE TABLE config_dumps (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flight_id     UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    raw_dump      TEXT NOT NULL,
    dump_type     TEXT NOT NULL DEFAULT 'dump_all',   -- 'dump_all' | 'diff_all'
    firmware_version TEXT,
    craft_name    TEXT,
    board_name    TEXT,
    parsed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- PID profiles (parsed from config dump)
-- ============================================================

CREATE TABLE pid_profiles (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_dump_id   UUID NOT NULL REFERENCES config_dumps(id) ON DELETE CASCADE,
    profile_index    INT NOT NULL,

    -- PID gains (dimensionless multipliers)
    pitch_p_gain     INT,   pitch_i_gain    INT,   pitch_d_gain    INT,
    pitch_f_gain     INT,   pitch_b_gain    INT,   pitch_o_gain    INT,
    roll_p_gain      INT,   roll_i_gain     INT,   roll_d_gain     INT,
    roll_f_gain      INT,   roll_b_gain     INT,   roll_o_gain     INT,
    yaw_p_gain       INT,   yaw_i_gain      INT,   yaw_d_gain      INT,
    yaw_f_gain       INT,   yaw_b_gain      INT,

    -- Per-axis gyro / D-term cutoff filters (Hz)
    pitch_gyro_cutoff_hz  INT,
    roll_gyro_cutoff_hz   INT,
    yaw_gyro_cutoff_hz    INT,
    pitch_d_cutoff_hz     INT,
    roll_d_cutoff_hz      INT,
    yaw_d_cutoff_hz       INT,

    -- Governor settings
    gov_headspeed_rpm     INT,    -- target RPM
    gov_gain              INT,
    gov_p_gain            INT,
    gov_i_gain            INT,
    gov_d_gain            INT,
    gov_f_gain            INT,
    gov_cyclic_ff_weight  INT,
    gov_collective_ff_weight INT,
    gov_yaw_ff_weight     INT,

    -- Overflow catch-all for firmware version differences
    extra_params          JSONB NOT NULL DEFAULT '{}',

    UNIQUE (config_dump_id, profile_index)
);


-- ============================================================
-- Rate profiles (parsed from config dump)
-- ============================================================

CREATE TABLE rate_profiles (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_dump_id   UUID NOT NULL REFERENCES config_dumps(id) ON DELETE CASCADE,
    profile_index    INT NOT NULL,

    rates_type       TEXT,           -- 'ACTUAL' | 'BETAFLIGHT' | 'RACEFLIGHT' etc.

    -- Actual Rates: rc_rate = center sensitivity, srate = max deg/s
    roll_rc_rate     INT,   pitch_rc_rate     INT,   yaw_rc_rate     INT,
    collective_rc_rate INT,
    roll_expo        INT,   pitch_expo        INT,   yaw_expo        INT,
    collective_expo  INT,
    roll_srate       INT,   pitch_srate       INT,   yaw_srate       INT,
    collective_srate INT,

    extra_params     JSONB NOT NULL DEFAULT '{}',

    UNIQUE (config_dump_id, profile_index)
);


-- ============================================================
-- Global filter settings (one row per config dump)
-- ============================================================

CREATE TABLE filter_settings (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_dump_id        UUID NOT NULL UNIQUE REFERENCES config_dumps(id) ON DELETE CASCADE,

    -- Global gyro LPF1 (Hz)
    gyro_lpf1_type        TEXT,
    gyro_lpf1_static_hz   INT,
    gyro_lpf1_dyn_min_hz  INT,
    gyro_lpf1_dyn_max_hz  INT,

    -- Global gyro LPF2 (Hz)
    gyro_lpf2_type        TEXT,
    gyro_lpf2_static_hz   INT,

    -- Static notches (Hz)
    gyro_notch1_hz        INT,  gyro_notch1_cutoff_hz  INT,
    gyro_notch2_hz        INT,  gyro_notch2_cutoff_hz  INT,

    -- Dynamic notch (Hz)
    dyn_notch_count       INT,
    dyn_notch_q           INT,
    dyn_notch_min_hz      INT,
    dyn_notch_max_hz      INT,

    -- RPM filter
    rpm_filter_enabled    BOOLEAN DEFAULT FALSE,
    gyro_decimation_hz    INT,

    extra_params          JSONB NOT NULL DEFAULT '{}'
);


-- ============================================================
-- Segments
-- ============================================================

CREATE TABLE segments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flight_id         UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    maneuver_type_id  UUID REFERENCES maneuver_types(id),
    pid_profile_id    UUID REFERENCES pid_profiles(id),
    rate_profile_id   UUID REFERENCES rate_profiles(id),

    label             TEXT NOT NULL,
    start_iteration   BIGINT NOT NULL,
    end_iteration     BIGINT NOT NULL,
    duration_loops    INT GENERATED ALWAYS AS (end_iteration - start_iteration) STORED,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT iteration_order CHECK (end_iteration > start_iteration)
);


-- ============================================================
-- Segment metrics — key/value store for computed results
-- ============================================================

CREATE TABLE segment_metrics (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_id    UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    module        TEXT NOT NULL,   -- 'tracking_error' | 'fft_vibration' | ...
    metric_name   TEXT NOT NULL,
    value_float   FLOAT,           -- scalar results
    value_json    JSONB,           -- array/object results (FFT data, filter bands)
    unit          TEXT,            -- 'deg/s' | 'Hz' | 'ms' | 'RPM' | 'au' | ...
    computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (segment_id, module, metric_name)
);

CREATE INDEX idx_segment_metrics_segment ON segment_metrics(segment_id);
CREATE INDEX idx_segment_metrics_module  ON segment_metrics(module);


-- ============================================================
-- AI analyses
-- ============================================================

CREATE TABLE ai_analyses (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_id       UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    model_used       TEXT NOT NULL,
    prompt_template  TEXT,
    narrative        TEXT,               -- free-text explanation
    structured_output JSONB,             -- {suggestions: [...], flags: [...]}
    status           TEXT NOT NULL DEFAULT 'pending',
    -- status: 'pending' | 'running' | 'complete' | 'error'
    error_message    TEXT,
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX idx_ai_analyses_segment ON ai_analyses(segment_id);
CREATE INDEX idx_ai_analyses_status  ON ai_analyses(status);
