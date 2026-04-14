# ── core/config.py ────────────────────────────────────────────────────────────
"""
Application settings loaded from environment variables.
All values can be overridden via docker-compose.yml environment section.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url:   str  = "postgresql+asyncpg://rf:rf_password@db:5432/rf_analyzer"
    data_dir:       str  = "/app/data"
    ai_service_url: str  = "http://ai:8001"
    frontend_url:   str  = "http://localhost:5173"
    secret_key:     str  = "change_me_in_production"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()