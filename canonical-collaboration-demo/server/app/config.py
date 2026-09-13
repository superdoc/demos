from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    collaboration_url: str = os.getenv("COLLABORATION_URL", "ws://localhost:8081")
    public_collaboration_url: str = os.getenv("PUBLIC_COLLABORATION_URL", "ws://localhost:8081")
    document_root: str = os.getenv("DOCUMENT_ROOT", "./data")
    room_ttl_seconds: int = int(os.getenv("ROOM_TTL_SECONDS", "3600"))
    completed_job_ttl_seconds: int = int(os.getenv("COMPLETED_JOB_TTL_SECONDS", "600"))
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5-mini")


settings = Settings()

