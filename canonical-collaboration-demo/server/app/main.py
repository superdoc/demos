import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agent import DocumentAgent
from .jobs import JobService
from .rooms import RoomStore
from .routes import create_router


rooms = RoomStore()
agent = DocumentAgent()
jobs = JobService(rooms, agent)


async def cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        expired_rooms = await rooms.expire()
        expired_jobs = jobs.expire()
        if expired_rooms or expired_jobs:
            print({"event": "cleanup", "rooms": expired_rooms, "jobs": expired_jobs}, flush=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    jobs.start()
    cleanup = asyncio.create_task(cleanup_loop())
    yield
    cleanup.cancel()
    await asyncio.gather(cleanup, return_exceptions=True)
    await jobs.stop()
    await rooms.close_all()


app = FastAPI(title="SuperDoc canonical collaboration demo", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:15173", "http://127.0.0.1:15173"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Location"],
)
app.include_router(create_router(rooms, jobs, agent))
