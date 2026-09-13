import asyncio
from datetime import timedelta
import json
from uuid import uuid4

from fastapi import HTTPException

from .agent import DocumentAgent
from .config import settings
from .models import CreateJobRequest, JobRecord, JobStatus
from .rooms import RoomStore, now


class JobService:
    def __init__(self, rooms: RoomStore, agent: DocumentAgent) -> None:
        self._rooms = rooms
        self._agent = agent
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._records: dict[str, JobRecord] = {}
        self._worker_task: asyncio.Task | None = None

    def start(self) -> None:
        self._worker_task = asyncio.create_task(self._work())

    async def stop(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
            await asyncio.gather(self._worker_task, return_exceptions=True)

    async def create(self, room_id: str, request: CreateJobRequest) -> JobRecord:
        await self._rooms.require(room_id)
        job_id = request.job_id or f"job_{uuid4().hex}"
        if job_id in self._records:
            raise HTTPException(409, "A job with this ID already exists.")
        timestamp = now()
        record = JobRecord(
            id=job_id,
            room_id=room_id,
            prompt=request.prompt.strip(),
            status=JobStatus.queued,
            created_at=timestamp,
            updated_at=timestamp,
        )
        self._records[job_id] = record
        await self._queue.put(job_id)
        print(json.dumps({"event": "job.queued", "jobId": job_id, "roomId": room_id}), flush=True)
        return record

    def get(self, room_id: str, job_id: str) -> JobRecord:
        record = self._records.get(job_id)
        if not record or record.room_id != room_id:
            raise HTTPException(404, "Job not found.")
        return record

    def expire(self) -> list[str]:
        cutoff = now() - timedelta(seconds=settings.completed_job_ttl_seconds)
        expired = [
            job_id
            for job_id, record in self._records.items()
            if record.status in (JobStatus.completed, JobStatus.failed) and record.updated_at < cutoff
        ]
        for job_id in expired:
            del self._records[job_id]
        return expired

    async def _work(self) -> None:
        while True:
            job_id = await self._queue.get()
            record = self._records.get(job_id)
            if not record:
                self._queue.task_done()
                continue
            room = None
            try:
                room = await self._rooms.require(record.room_id)
                room.active_jobs += 1
                record.status = JobStatus.running
                record.updated_at = now()
                record.answer = await self._agent.run(room.editor_document, record.prompt, room.conversation)
                record.status = JobStatus.applying_edit
                record.updated_at = now()
                await asyncio.sleep(0)
                room.last_activity_at = now()
                record.status = JobStatus.completed
            except Exception as error:
                record.status = JobStatus.failed
                record.error = str(error)
            finally:
                record.updated_at = now()
                if room:
                    room.active_jobs = max(0, room.active_jobs - 1)
                print(
                    json.dumps({"event": "job.finished", "jobId": job_id, "status": record.status}),
                    flush=True,
                )
                self._queue.task_done()
