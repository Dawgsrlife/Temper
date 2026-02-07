"""
Temper Backend – Configuration

Loads environment variables from root .env file.
All services (frontend + backend) share the same .env.
"""

import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load from monorepo root
_root = Path(__file__).resolve().parents[2]
load_dotenv(_root / ".env")


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""

    # Server
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000"
    debug: bool = True

    # AI
    openai_api_key: str = ""

    class Config:
        env_file = str(_root / ".env")
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
