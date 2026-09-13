from fastapi import APIRouter, File, Response, UploadFile, status

from .jobs import JobService
from .models import (
    ActivityRequest,
    ChatHistoryResponse,
    ChatMessage,
    CreateJobRequest,
    DocumentPatch,
    JobRecord,
    RoomResponse,
    RoomStateResponse,
)
from .rooms import RoomStore
from .rooms import now
from .agent import DocumentAgent


def create_router(rooms: RoomStore, jobs: JobService, agent: DocumentAgent) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/rooms/{room_id}", response_model=RoomStateResponse)
    async def room_state(room_id: str) -> RoomStateResponse:
        room = await rooms.find(room_id)
        return RoomStateResponse(
            room_id=room_id,
            document=rooms.response(room) if room else None,
        )

    @router.put("/rooms/{room_id}/document", response_model=RoomResponse)
    async def replace_document(room_id: str, file: UploadFile = File(...)) -> RoomResponse:
        return rooms.response(await rooms.replace(room_id, file))

    @router.get("/rooms/{room_id}/document/info", response_model=RoomResponse)
    async def document_info(room_id: str) -> RoomResponse:
        return rooms.response(await rooms.require(room_id))

    @router.get("/rooms/{room_id}/document")
    async def download_document(room_id: str) -> Response:
        room, content = await rooms.export(room_id)
        return Response(
            content,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{room.filename}"'},
        )

    @router.patch("/rooms/{room_id}/document")
    async def patch_document(room_id: str, patch: DocumentPatch):
        room = await rooms.require(room_id)
        result = await agent.dispatch(room.editor_document, patch.tool, patch.arguments)
        room.last_activity_at = now()
        return {"ok": True, "result": result}

    @router.delete("/rooms/{room_id}/document", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_document(room_id: str) -> Response:
        await rooms.delete(room_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/rooms/{room_id}/activity", status_code=status.HTTP_204_NO_CONTENT)
    async def activity(room_id: str, request: ActivityRequest) -> Response:
        await rooms.touch(room_id, request.generation)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/rooms/{room_id}/chat", response_model=ChatHistoryResponse)
    async def chat_history(room_id: str) -> ChatHistoryResponse:
        room = await rooms.require(room_id)
        return ChatHistoryResponse(messages=[ChatMessage(**message) for message in room.conversation])

    @router.post("/rooms/{room_id}/jobs", response_model=JobRecord, status_code=status.HTTP_202_ACCEPTED)
    async def create_job(room_id: str, request: CreateJobRequest, response: Response) -> JobRecord:
        record = await jobs.create(room_id, request)
        response.headers["Location"] = f"/api/rooms/{room_id}/jobs/{record.id}"
        return record

    @router.get("/rooms/{room_id}/jobs/{job_id}", response_model=JobRecord)
    async def get_job(room_id: str, job_id: str) -> JobRecord:
        return jobs.get(room_id, job_id)

    return router
