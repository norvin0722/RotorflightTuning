import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, BigInteger, Boolean,
    ForeignKey, Text, DateTime, JSON
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def gen_uuid():
    return str(uuid.uuid4())


class Flight(Base):
    __tablename__ = "flights"
    id               = Column(String, primary_key=True, default=gen_uuid)
    name             = Column(String, nullable=False)
    craft_name       = Column(String)
    flown_at         = Column(DateTime(timezone=True), nullable=True)
    csv_filename     = Column(String)
    csv_path         = Column(String, nullable=True)
    total_loop_iterations = Column(BigInteger)
    sample_rate_hz   = Column(Float)
    duration_s       = Column(Float)
    firmware_version = Column(String)
    board_name       = Column(String)
    notes            = Column(Text)
    created_at       = Column(DateTime(timezone=True), default=datetime.utcnow)
    segments         = relationship("Segment", back_populates="flight", cascade="all, delete-orphan")
    config_dumps     = relationship("ConfigDump", back_populates="flight", cascade="all, delete-orphan")


class Segment(Base):
    __tablename__ = "segments"
    id               = Column(String, primary_key=True, default=gen_uuid)
    flight_id        = Column(String, ForeignKey("flights.id", ondelete="CASCADE"), nullable=False)
    label            = Column(String, nullable=False)
    start_iteration  = Column(BigInteger)
    end_iteration    = Column(BigInteger)
    csv_path         = Column(String)
    row_count        = Column(Integer)
    notes            = Column(Text)
    analysis_status  = Column(String, default="pending")
    created_at       = Column(DateTime(timezone=True), default=datetime.utcnow)
    flight           = relationship("Flight", back_populates="segments")
    metrics          = relationship("SegmentMetric", back_populates="segment", cascade="all, delete-orphan")
    ai_analyses      = relationship("AIAnalysis", back_populates="segment", cascade="all, delete-orphan")

    @property
    def duration_loops(self):
        if self.start_iteration is not None and self.end_iteration is not None:
            return int(self.end_iteration - self.start_iteration)
        return None


class SegmentMetric(Base):
    __tablename__ = "segment_metrics"
    id           = Column(String, primary_key=True, default=gen_uuid)
    segment_id   = Column(String, ForeignKey("segments.id", ondelete="CASCADE"), nullable=False)
    module       = Column(String, nullable=False)
    metric_name  = Column(String, nullable=False)
    value_float  = Column(Float, nullable=True)
    value_json   = Column(JSON, nullable=True)
    unit         = Column(String)
    computed_at  = Column(DateTime(timezone=True), default=datetime.utcnow)
    segment      = relationship("Segment", back_populates="metrics")


class ConfigDump(Base):
    __tablename__ = "config_dumps"
    id           = Column(String, primary_key=True, default=gen_uuid)
    flight_id    = Column(String, ForeignKey("flights.id", ondelete="CASCADE"), nullable=True)
    raw_text     = Column(Text)
    craft_name   = Column(String)
    firmware     = Column(String)
    created_at   = Column(DateTime(timezone=True), default=datetime.utcnow)
    flight       = relationship("Flight", back_populates="config_dumps")
    pid_profiles = relationship("PIDProfile", back_populates="config_dump", cascade="all, delete-orphan")
    rate_profiles= relationship("RateProfile", back_populates="config_dump", cascade="all, delete-orphan")
    filter_settings = relationship("FilterSetting", back_populates="config_dump", cascade="all, delete-orphan")


class PIDProfile(Base):
    __tablename__ = "pid_profiles"
    id            = Column(String, primary_key=True, default=gen_uuid)
    config_dump_id= Column(String, ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False)
    profile_index = Column(Integer, nullable=False)
    target_rpm    = Column(Integer)
    roll_p        = Column(Integer); roll_i = Column(Integer); roll_d = Column(Integer); roll_f = Column(Integer)
    pitch_p       = Column(Integer); pitch_i= Column(Integer); pitch_d= Column(Integer); pitch_f= Column(Integer)
    yaw_p         = Column(Integer); yaw_i  = Column(Integer); yaw_d  = Column(Integer); yaw_f  = Column(Integer)
    roll_gyro_cutoff  = Column(Integer)
    pitch_gyro_cutoff = Column(Integer)
    yaw_gyro_cutoff   = Column(Integer)
    gov_p         = Column(Integer); gov_i  = Column(Integer); gov_f  = Column(Integer)
    is_active     = Column(Boolean, default=False)
    config_dump   = relationship("ConfigDump", back_populates="pid_profiles")


class RateProfile(Base):
    __tablename__ = "rate_profiles"
    id            = Column(String, primary_key=True, default=gen_uuid)
    config_dump_id= Column(String, ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False)
    profile_index = Column(Integer, nullable=False)
    roll_rc_rate  = Column(Float); roll_srate = Column(Float); roll_expo = Column(Float)
    pitch_rc_rate = Column(Float); pitch_srate= Column(Float); pitch_expo= Column(Float)
    yaw_rc_rate   = Column(Float); yaw_srate  = Column(Float); yaw_expo  = Column(Float)
    config_dump   = relationship("ConfigDump", back_populates="rate_profiles")


class FilterSetting(Base):
    __tablename__ = "filter_settings"
    id             = Column(String, primary_key=True, default=gen_uuid)
    config_dump_id = Column(String, ForeignKey("config_dumps.id", ondelete="CASCADE"), nullable=False)
    lpf1_type      = Column(String); lpf1_hz    = Column(Integer)
    lpf2_type      = Column(String); lpf2_hz    = Column(Integer)
    dyn_notch_count= Column(Integer); dyn_notch_q= Column(Integer)
    dyn_notch_min_hz= Column(Integer); dyn_notch_max_hz= Column(Integer)
    rpm_filter_enabled = Column(Boolean, default=False)
    config_dump    = relationship("ConfigDump", back_populates="filter_settings")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"
    id               = Column(String, primary_key=True, default=gen_uuid)
    segment_id       = Column(String, ForeignKey("segments.id", ondelete="CASCADE"), nullable=False)
    model_used       = Column(String)
    narrative        = Column(Text)
    structured_output= Column(JSON)
    status           = Column(String, default="pending")
    requested_at     = Column(DateTime(timezone=True), default=datetime.utcnow)
    completed_at     = Column(DateTime(timezone=True), nullable=True)
    segment          = relationship("Segment", back_populates="ai_analyses")
