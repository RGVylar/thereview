from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://thereview:thereview@localhost:5432/thereview"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24h

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
