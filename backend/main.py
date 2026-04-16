from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import klines, indicators, live, marks, swings, series, ranges
from .db import init_marks_db

app = FastAPI(title="Trading Analysis API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(klines.router)
app.include_router(indicators.router)
app.include_router(live.router)
app.include_router(marks.router)
app.include_router(swings.router)
app.include_router(series.router)
app.include_router(ranges.router)


@app.on_event("startup")
async def startup() -> None:
    init_marks_db()


@app.get("/")
def root():
    return {"status": "ok", "message": "Trading Analysis API"}
