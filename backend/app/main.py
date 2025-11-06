from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from datetime import date
from loguru import logger
from titiler.core.factory import TilerFactory
from titiler.mosaic.factory import MosaicTilerFactory  # <-- NEW
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from typing import List, Dict
from uuid import uuid4
from pydantic import BaseModel
from fastapi import HTTPException
from cogeo_mosaic.mosaic import MosaicJSON
from fastapi import APIRouter

from .settings import settings
from .stac import search_items

app = FastAPI(title="Satellite Data Explorer API", version="0.1.0")

cog = TilerFactory()
app.include_router(cog.router, prefix="/cog", tags=["COG"])

mosaic = MosaicTilerFactory()                     # provides /mosaic/mosaicjson + /mosaic/tiles...
app.include_router(mosaic.router, prefix="/mosaic", tags=["Mosaic"])
# mosaic_router = APIRouter(prefix="/mosaic", tags=["Mosaic"])
# mosaic = MosaicTilerFactory(router=mosaic_router)   # <-- pass the prefixed router
# app.include_router(mosaic.router)                   

# (optional) better error messages
add_exception_handlers(app, DEFAULT_STATUS_CODES)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # typical Vite dev port
        "http://localhost:5174",  # your current frontend port
        "http://127.0.0.1:5173",

    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




@app.get("/health")
def health():
    return {"ok": True}

@app.get("/search")
def search(
    request: Request,
    bbox: Optional[List[str]] = Query(None, description="Either 4 repeated params or a single comma-separated string"),
    start: date = Query(...),
    end: date = Query(...),
    cloud_max: int = Query(20, ge=0, le=100),
    limit: int = Query(50, ge=1, le=100),
):
    # Gather raw bbox values (handles both styles):
    raw = request.query_params.getlist("bbox")
    logger.info(f"raw bbox params: {raw}")

    vals: List[float] = []
    for token in raw:
        # split each token by comma to support "bbox=a,b,c,d" OR "bbox=a&bbox=b..."
        parts = [p for p in token.replace(" ", "").split(",") if p]
        for p in parts:
            try:
                vals.append(float(p))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"bbox value '{p}' is not a number")

    if len(vals) != 4:
        raise HTTPException(status_code=400, detail="bbox must have 4 numeric values (minx,miny,maxx,maxy)")

    logger.info(f"parsed bbox: {vals}")
    return {"results": search_items(vals, start, end, cloud_max, limit)}

MOSAIC_STORE: Dict[str, MosaicJSON] = {}

class MosaicCreate(BaseModel):
    urls: List[str]
    minzoom: int = 6
    maxzoom: int = 14
    quadkey_zoom: int = 12

@app.post("/mosaics", tags=["Mosaic"])
def create_mosaic_endpoint(body: MosaicCreate):
    if not body.urls:
        raise HTTPException(status_code=400, detail="urls cannot be empty")

    # Build a real MosaicJSON using the classmethod available in v7+
    mosaic = MosaicJSON.from_urls(
        body.urls,
        minzoom=body.minzoom,
        maxzoom=body.maxzoom,
        quadkey_zoom=body.quadkey_zoom,
    )

    mid = str(uuid4())
    MOSAIC_STORE[mid] = mosaic
    return {"id": mid}

@app.get("/mosaics/{mosaic_id}", tags=["Mosaic"])
def get_mosaic(mosaic_id: str):
    m = MOSAIC_STORE.get(mosaic_id)
    if not m:
        raise HTTPException(status_code=404, detail="mosaic not found")
    # Serve as JSON document TiTiler can read via ?url=
    return m.dict()