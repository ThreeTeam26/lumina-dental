"""
Pydantic Settings – loads values from .env automatically.
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────────────────
    # Local dev: left at this default → SQLite, no setup required.
    # Production (Railway): set DATABASE_URL to the Supabase Postgres
    # connection string as an environment variable — never in source.
    DATABASE_URL: str = "sqlite:///./database.db"

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """Supabase/Railway commonly hand out `postgres://...` (the old
        Heroku-style scheme) or a driverless `postgresql://...` URL.
        SQLAlchemy 2.x rejects the former outright and defaults the latter to
        psycopg2, which this project doesn't install — normalize both to
        explicitly request the `psycopg` (v3) driver that's actually in
        requirements.txt. SQLite URLs, and any URL that already names a
        driver (e.g. `postgresql+psycopg://`), pass through unchanged."""
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    # ── JWT / Auth ────────────────────────────────────────────────────────
    SECRET_KEY: str = "change-me-to-a-long-random-string-in-production"
    JWT_ALGORITHM: str = "HS256"
    # 7 days — a clinic admin shouldn't be silently logged out mid-shift (a
    # 60-min token was expiring during use, which made the dashboard fall back
    # to an empty list on refresh and look like the data had been wiped).
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # ── CORS ──────────────────────────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Also allow any localhost / 127.0.0.1 / private-LAN origin on any port, so
    # the dashboard connects whether it's opened via localhost, 127.0.0.1, or a
    # LAN IP (phone/other device on the same network).
    CORS_ORIGIN_REGEX: str = (
        r"^https?://(localhost|127\.0\.0\.1|"
        r"192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$"
    )

    # ── Queue / consultation timing ──────────────────────────────────────
    MIN_CONSULTATION_MINUTES: int = 10
    MAX_CONSULTATION_MINUTES: int = 15
    # How many days ahead a patient is allowed to book.
    BOOKING_WINDOW_DAYS: int = 60

    # ── WhatsApp Cloud API (optional — reminders no-op until configured) ───
    WHATSAPP_API_URL: str = ""
    WHATSAPP_API_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    # Send the reminder once a patient's estimated wait drops to this or below.
    REMINDER_LEAD_MINUTES: int = 60

    @property
    def cors_origin_list(self) -> list[str]:
        """Return CORS_ORIGINS as a Python list (comma-separated in .env)."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
