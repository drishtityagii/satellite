from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    STAC_API_URL: str = "https://earth-search.aws.element84.com/v1"
    DEFAULT_COLLECTIONS: str = "sentinel-2-l2a"
    CORS_ORIGINS: str = "http://localhost:5173"  # Vite dev server

    class Config:
        env_file = ".env"

settings = Settings()