"""
Supabase client for database operations.

Tables (matching your architecture):
- users
- trade_sets (jobs)
- sessions
- temper_reports
- decision_elo
- user_baselines
"""

import os
from functools import lru_cache

from supabase import create_client, Client

from app.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Get singleton Supabase client."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# Convenience export
supabase = get_supabase
