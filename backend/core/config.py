from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://rf:rf@db:5432/rf_analyzer"
    lm_studio_base_url: str = "http://localhost:1234/v1"
    lm_studio_model: str = "gemma-4-e4b"
    data_dir: str = "/app/data"

    class Config:
        env_file = ".env"


settings = Settings()
