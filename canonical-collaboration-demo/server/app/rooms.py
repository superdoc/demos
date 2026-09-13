import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from superdoc import AsyncSuperDocClient

from .config import settings
from .models import RoomResponse


ROOM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Room:
    room_id: str
    document_id: str
    generation: int
    filename: str
    path: Path
    last_activity_at: datetime
    seeder_client: Any
    seeder_document: Any
    editor_client: Any
    editor_document: Any
    active_jobs: int = 0
    conversation: list[dict[str, Any]] = field(default_factory=list)


class RoomStore:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()
        self._root = Path(settings.document_root)
        self._root.mkdir(parents=True, exist_ok=True)

    def validate_id(self, room_id: str) -> None:
        if not ROOM_ID_PATTERN.fullmatch(room_id):
            raise HTTPException(400, "Room IDs may contain letters, numbers, underscores, and hyphens.")

    def _collaboration(self, document_id: str, mode: str) -> dict[str, Any]:
        return {
            "providerType": "hocuspocus",
            "url": settings.collaboration_url,
            "documentId": document_id,
            "roomMode": mode,
            "syncTimeoutMs": 90_000,
        }

    def _client(self, name: str) -> AsyncSuperDocClient:
        return AsyncSuperDocClient(
            startup_timeout_ms=20_000,
            request_timeout_ms=150_000,
            watchdog_timeout_ms=180_000,
            default_change_mode="direct",
            user={"name": name, "email": f"{name.lower().replace(' ', '-')}@demo.local"},
        )

    async def _open(self, path: Path, document_id: str) -> tuple[Any, Any, Any, Any]:
        seeder_client = self._client("Room seeder")
        editor_client = self._client("Backend worker")
        try:
            await seeder_client.connect()
            seeder_document = await seeder_client.open(
                {"doc": str(path), "collaboration": self._collaboration(document_id, "create")},
                timeout_ms=150_000,
            )
            await editor_client.connect()
            editor_document = await editor_client.open(
                {"collaboration": self._collaboration(document_id, "join")},
                timeout_ms=150_000,
            )
            return seeder_client, seeder_document, editor_client, editor_document
        except Exception:
            await seeder_client.dispose()
            await editor_client.dispose()
            raise

    async def replace(self, room_id: str, upload: UploadFile) -> Room:
        self.validate_id(room_id)
        if not upload.filename or not upload.filename.lower().endswith(".docx"):
            raise HTTPException(400, "Upload a .docx document.")
        content = await upload.read(25 * 1024 * 1024 + 1)
        if not content or len(content) > 25 * 1024 * 1024:
            raise HTTPException(400, "The document must be between 1 byte and 25 MB.")

        async with self._lock:
            previous = self._rooms.get(room_id)
            generation = (previous.generation + 1) if previous else 1
            document_id = f"{room_id}--g{generation}--{uuid4().hex[:8]}"
            path = self._root / f"{document_id}.docx"
            path.write_bytes(content)
            try:
                sessions = await self._open(path, document_id)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            room = Room(room_id, document_id, generation, upload.filename, path, now(), *sessions)
            self._rooms[room_id] = room
            if previous:
                await self._close(previous)
            print(f'{{"event":"room.replaced","roomId":"{room_id}","documentId":"{document_id}"}}', flush=True)
            return room

    async def require(self, room_id: str, touch: bool = True) -> Room:
        self.validate_id(room_id)
        room = self._rooms.get(room_id)
        if not room:
            raise HTTPException(404, "This room does not have a document.")
        if touch:
            room.last_activity_at = now()
        return room

    async def find(self, room_id: str) -> Room | None:
        self.validate_id(room_id)
        room = self._rooms.get(room_id)
        if room:
            room.last_activity_at = now()
        return room

    async def touch(self, room_id: str, generation: int) -> Room:
        room = await self.require(room_id, touch=False)
        if room.generation != generation:
            raise HTTPException(409, "The room document has been replaced.")
        room.last_activity_at = now()
        return room

    async def export(self, room_id: str) -> tuple[Room, bytes]:
        room = await self.require(room_id)
        export_path = self._root / f"{room.document_id}-export-{uuid4().hex}.docx"
        try:
            await room.editor_document.save({"out": str(export_path), "force": True})
            return room, export_path.read_bytes()
        finally:
            export_path.unlink(missing_ok=True)

    async def delete(self, room_id: str) -> None:
        async with self._lock:
            room = self._rooms.pop(room_id, None)
            if not room:
                raise HTTPException(404, "This room does not have a document.")
            await self._close(room)
            print(f'{{"event":"room.deleted","roomId":"{room_id}"}}', flush=True)

    async def expire(self) -> list[str]:
        cutoff = now().timestamp() - settings.room_ttl_seconds
        expired = [
            room_id
            for room_id, room in self._rooms.items()
            if room.last_activity_at.timestamp() < cutoff and room.active_jobs == 0
        ]
        for room_id in expired:
            try:
                await self.delete(room_id)
            except HTTPException:
                pass
        return expired

    async def close_all(self) -> None:
        for room in list(self._rooms.values()):
            await self._close(room)
        self._rooms.clear()

    async def _close(self, room: Room) -> None:
        for document in (room.editor_document, room.seeder_document):
            try:
                await document.close({"discard": True})
            except Exception:
                pass
        for client in (room.editor_client, room.seeder_client):
            try:
                await client.dispose()
            except Exception:
                pass
        room.path.unlink(missing_ok=True)

    def response(self, room: Room) -> RoomResponse:
        return RoomResponse(
            room_id=room.room_id,
            document_id=room.document_id,
            generation=room.generation,
            filename=room.filename,
            last_activity_at=room.last_activity_at,
            collaboration_url=settings.public_collaboration_url,
        )
