from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://rf:rf@db:5432/rf_analyzer"
    anthropic_api_key: str = ""
    data_dir: str = "/app/data"

    class Config:
        env_file = ".env"


settings = Settings()
