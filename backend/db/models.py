"""
SQLAlchemy ORM models — mirrors init.sql exactly.
Uses mapped_column() style (SQLAlchemy 2.x).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer,
    String, Text, BigInteger, UniqueConstraint, CheckConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.utcnow()


# ── ManeuverType ──────────────────────────────────────────────────────────────

class ManeuverType(Base):
    __tablename__ = "maneuver_types"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name:        Mapped[str]       = mapped_column(String, nullable=False, unique=True)
    is_custom:   Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None]= mapped_column(Text)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now)

    segments: Mapped[list["Segment"]] = relationship(back_populates="maneuver_type_rel")


# ── Flight ────────────────────────────────────────────────────────────────────

class Flight(Base):
    __tablename__ = "flights"

    id:                    Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name:                  Mapped[str]          = mapped_column(String, nullable=False)
    craft_name:            Mapped[str | None]   = mapped_column(String)
    flown_at:              Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    csv_filename:          Mapped[str | None]   = mapped_column(String)
    csv_path:              Mapped[str | None]   = mapped_column(String)
    total_loop_iterations: Mapped[int | None]   = mapped_column(BigInteger)
    sample_rate_hz:        Mapped[float | None] = mapped_column(Float)
    duration_s:            Mapped[float | None] = mapped_column(Float)
    firmware_version:      Mapped[str | None]   = mapped_column(String)
    board_name:            Mapped[str | None]   = mapped_column(String)
    notes:                 Mapped[str | None]   = mapped_column(Text)
    created_at:            Mapped[datetime]     = mapped_column(DateTime(timezone=True), default=_now)

    segments:     Mapped[list["Segment"]]    = relationship(back_populates="flight", cascade="all, delete-orphan")
    config_dumps: Mapped[list["ConfigDump"]] = relationship(back_populates="flight", cascade="all, delete-orphan")


# ── ConfigDump ────────────────────────────────────────────────────────────────

class ConfigDump(Base):
    __tablename__ = "config_dumps"

    id:               Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    flight_id:        Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("flights.id", ondelete="CASCADE"), nullable=False)
    raw_dump:         Mapped[str]        = mapped_column(Text, nullable=False)
    dump_type:        Mapped[str]        = mapped_column(String, default="dump_all")
    firmware_version: Mapped[str | None] = mapped_column(String)
    craft_name:       Mapped[str | None] = mapped_column(String)
    board_name:       Mapped[str | None] = mapped_column(String)
    parsed_at:        Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at:       Mapped[datetime]   = mapped_column(DateTime(timezone=True), default=_now)

    flight:       Mapped["Flight"]           = relationship(back_populates="config_dumps")
    pid_profiles: Mapped[list["PidProfile"]] = relationship(back_populates="config_dump", cascade="all, delete-orphan")
    rate_profiles: Mapped[list["RateProfile"]] = relationship(back_populates="config_dump", cascade="all, delete-orphan")
    filter_settings: Mapped["FilterSetting | None"] = relationship(back_populates="config_dump", cascade="all, delete-orphan", uselist=False)


# ── PidProfile ────────────────────────────────────────────────────────────────

class PidProfile(Base):
    __tablename__ = "pid_profiles"
    __table_args__ = (UniqueConstraint("config_dump_id", "profile_index"),)

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    config_dump_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False)
    profile_index:  Mapped[int]       = mapped_column(Integer, nullable=False)

    # PID gains (dimensionless)
    pitch_p_gain: Mapped[int | None] = mapped_column(Integer)
    pitch_i_gain: Mapped[int | None] = mapped_column(Integer)
    pitch_d_gain: Mapped[int | None] = mapped_column(Integer)
    pitch_f_gain: Mapped[int | None] = mapped_column(Integer)
    pitch_b_gain: Mapped[int | None] = mapped_column(Integer)
    pitch_o_gain: Mapped[int | None] = mapped_column(Integer)
    roll_p_gain:  Mapped[int | None] = mapped_column(Integer)
    roll_i_gain:  Mapped[int | None] = mapped_column(Integer)
    roll_d_gain:  Mapped[int | None] = mapped_column(Integer)
    roll_f_gain:  Mapped[int | None] = mapped_column(Integer)
    roll_b_gain:  Mapped[int | None] = mapped_column(Integer)
    roll_o_gain:  Mapped[int | None] = mapped_column(Integer)
    yaw_p_gain:   Mapped[int | None] = mapped_column(Integer)
    yaw_i_gain:   Mapped[int | None] = mapped_column(Integer)
    yaw_d_gain:   Mapped[int | None] = mapped_column(Integer)
    yaw_f_gain:   Mapped[int | None] = mapped_column(Integer)
    yaw_b_gain:   Mapped[int | None] = mapped_column(Integer)

    # Per-axis cutoff filters (Hz)
    pitch_gyro_cutoff_hz: Mapped[int | None] = mapped_column(Integer)
    roll_gyro_cutoff_hz:  Mapped[int | None] = mapped_column(Integer)
    yaw_gyro_cutoff_hz:   Mapped[int | None] = mapped_column(Integer)
    pitch_d_cutoff_hz:    Mapped[int | None] = mapped_column(Integer)
    roll_d_cutoff_hz:     Mapped[int | None] = mapped_column(Integer)
    yaw_d_cutoff_hz:      Mapped[int | None] = mapped_column(Integer)

    # Governor (RPM for headspeed, dimensionless for gains)
    gov_headspeed_rpm:        Mapped[int | None] = mapped_column(Integer)
    gov_gain:                 Mapped[int | None] = mapped_column(Integer)
    gov_p_gain:               Mapped[int | None] = mapped_column(Integer)
    gov_i_gain:               Mapped[int | None] = mapped_column(Integer)
    gov_d_gain:               Mapped[int | None] = mapped_column(Integer)
    gov_f_gain:               Mapped[int | None] = mapped_column(Integer)
    gov_cyclic_ff_weight:     Mapped[int | None] = mapped_column(Integer)
    gov_collective_ff_weight: Mapped[int | None] = mapped_column(Integer)
    gov_yaw_ff_weight:        Mapped[int | None] = mapped_column(Integer)

    extra_params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    config_dump: Mapped["ConfigDump"] = relationship(back_populates="pid_profiles")
    segments:    Mapped[list["Segment"]] = relationship(back_populates="pid_profile_rel")


# ── RateProfile ───────────────────────────────────────────────────────────────

class RateProfile(Base):
    __tablename__ = "rate_profiles"
    __table_args__ = (UniqueConstraint("config_dump_id", "profile_index"),)

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    config_dump_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False)
    profile_index:  Mapped[int]       = mapped_column(Integer, nullable=False)
    rates_type:     Mapped[str | None]= mapped_column(String)

    # Actual Rates (deg/s for srate, dimensionless for rc_rate/expo)
    roll_rc_rate:       Mapped[int | None] = mapped_column(Integer)
    pitch_rc_rate:      Mapped[int | None] = mapped_column(Integer)
    yaw_rc_rate:        Mapped[int | None] = mapped_column(Integer)
    collective_rc_rate: Mapped[int | None] = mapped_column(Integer)
    roll_expo:          Mapped[int | None] = mapped_column(Integer)
    pitch_expo:         Mapped[int | None] = mapped_column(Integer)
    yaw_expo:           Mapped[int | None] = mapped_column(Integer)
    collective_expo:    Mapped[int | None] = mapped_column(Integer)
    roll_srate:         Mapped[int | None] = mapped_column(Integer)   # deg/s
    pitch_srate:        Mapped[int | None] = mapped_column(Integer)   # deg/s
    yaw_srate:          Mapped[int | None] = mapped_column(Integer)   # deg/s
    collective_srate:   Mapped[int | None] = mapped_column(Integer)

    extra_params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    config_dump: Mapped["ConfigDump"] = relationship(back_populates="rate_profiles")
    segments:    Mapped[list["Segment"]] = relationship(back_populates="rate_profile_rel")


# ── FilterSetting ─────────────────────────────────────────────────────────────

class FilterSetting(Base):
    __tablename__ = "filter_settings"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    config_dump_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False, unique=True)

    # All Hz values
    gyro_lpf1_type:       Mapped[str | None] = mapped_column(String)
    gyro_lpf1_static_hz:  Mapped[int | None] = mapped_column(Integer)
    gyro_lpf1_dyn_min_hz: Mapped[int | None] = mapped_column(Integer)
    gyro_lpf1_dyn_max_hz: Mapped[int | None] = mapped_column(Integer)
    gyro_lpf2_type:       Mapped[str | None] = mapped_column(String)
    gyro_lpf2_static_hz:  Mapped[int | None] = mapped_column(Integer)
    gyro_notch1_hz:       Mapped[int | None] = mapped_column(Integer)
    gyro_notch1_cutoff_hz:Mapped[int | None] = mapped_column(Integer)
    gyro_notch2_hz:       Mapped[int | None] = mapped_column(Integer)
    gyro_notch2_cutoff_hz:Mapped[int | None] = mapped_column(Integer)
    dyn_notch_count:      Mapped[int | None] = mapped_column(Integer)
    dyn_notch_q:          Mapped[int | None] = mapped_column(Integer)
    dyn_notch_min_hz:     Mapped[int | None] = mapped_column(Integer)
    dyn_notch_max_hz:     Mapped[int | None] = mapped_column(Integer)
    rpm_filter_enabled:   Mapped[bool | None]= mapped_column(Boolean)
    gyro_decimation_hz:   Mapped[int | None] = mapped_column(Integer)
    extra_params:         Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    config_dump: Mapped["ConfigDump"] = relationship(back_populates="filter_settings")


# ── Segment ───────────────────────────────────────────────────────────────────

class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (
        CheckConstraint("end_iteration > start_iteration", name="iteration_order"),
    )

    id:               Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    flight_id:        Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("flights.id", ondelete="CASCADE"), nullable=False)
    maneuver_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("maneuver_types.id"))
    pid_profile_id:   Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("pid_profiles.id"))
    rate_profile_id:  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rate_profiles.id"))

    label:           Mapped[str]        = mapped_column(String, nullable=False)
    start_iteration: Mapped[int]        = mapped_column(BigInteger, nullable=False)
    end_iteration:   Mapped[int]        = mapped_column(BigInteger, nullable=False)
    csv_path:        Mapped[str | None] = mapped_column(String)   # path to stored segment CSV slice
    row_count:       Mapped[int | None] = mapped_column(Integer)  # number of data rows in slice
    notes:           Mapped[str | None] = mapped_column(Text)
    created_at:      Mapped[datetime]   = mapped_column(DateTime(timezone=True), default=_now)

    flight:           Mapped["Flight"]      = relationship(back_populates="segments")
    maneuver_type_rel: Mapped["ManeuverType | None"] = relationship(back_populates="segments")
    pid_profile_rel:  Mapped["PidProfile | None"]  = relationship(back_populates="segments")
    rate_profile_rel: Mapped["RateProfile | None"] = relationship(back_populates="segments")
    metrics:          Mapped[list["SegmentMetric"]] = relationship(back_populates="segment", cascade="all, delete-orphan")
    ai_analyses:      Mapped[list["AiAnalysis"]]    = relationship(back_populates="segment", cascade="all, delete-orphan")


# ── SegmentMetric ─────────────────────────────────────────────────────────────

class SegmentMetric(Base):
    __tablename__ = "segment_metrics"
    __table_args__ = (UniqueConstraint("segment_id", "module", "metric_name"),)

    id:          Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    segment_id:  Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("segments.id", ondelete="CASCADE"), nullable=False)
    module:      Mapped[str]        = mapped_column(String, nullable=False)
    metric_name: Mapped[str]        = mapped_column(String, nullable=False)
    value_float: Mapped[float | None] = mapped_column(Float)
    value_json:  Mapped[Any | None]   = mapped_column(JSONB)
    unit:        Mapped[str | None]   = mapped_column(String)
    computed_at: Mapped[datetime]     = mapped_column(DateTime(timezone=True), default=_now)

    segment: Mapped["Segment"] = relationship(back_populates="metrics")


# ── AiAnalysis ────────────────────────────────────────────────────────────────

class AiAnalysis(Base):
    __tablename__ = "ai_analyses"

    id:                Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    segment_id:        Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("segments.id", ondelete="CASCADE"), nullable=False)
    model_used:        Mapped[str]        = mapped_column(String, nullable=False)
    prompt_template:   Mapped[str | None] = mapped_column(Text)
    narrative:         Mapped[str | None] = mapped_column(Text)
    structured_output: Mapped[Any | None] = mapped_column(JSONB)
    status:            Mapped[str]        = mapped_column(String, default="pending")
    error_message:     Mapped[str | None] = mapped_column(Text)
    requested_at:      Mapped[datetime]   = mapped_column(DateTime(timezone=True), default=_now)
    completed_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    segment: Mapped["Segment"] = relationship(back_populates="ai_analyses")
