from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    applying_edit = "applying_edit"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class CreateJobRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    job_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,100}$")


class JobRecord(BaseModel):
    id: str
    room_id: str
    prompt: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    answer: str | None = None
    error: str | None = None


class RoomResponse(BaseModel):
    room_id: str
    document_id: str
    generation: int
    filename: str
    last_activity_at: datetime
    collaboration_url: str


class RoomStateResponse(BaseModel):
    room_id: str
    document: RoomResponse | None


class DocumentPatch(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ActivityRequest(BaseModel):
    generation: int


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatHistoryResponse(BaseModel):
    messages: list[ChatMessage]
