from datetime import date
from typing import List, Optional

from pystac_client import Client

from .settings import settings

client = Client.open(settings.STAC_API_URL)

def search_items(
    bbox: List[float],
    start: date,
    end: date,
    cloud_max: int,
    limit: int = 50,
):
    collections = [c.strip() for c in settings.DEFAULT_COLLECTIONS.split(",") if c.strip()]
    items = client.search(
        bbox=bbox,
        collections=collections,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        max_items=limit,
        query={"eo:cloud_cover": {"lte": cloud_max}},
        sortby=[{"field": "properties.datetime", "direction": "desc"}],
    ).items()

    # Return compact records
    out = []
    for it in items:
        props = it.properties or {}
        assets = it.assets or {}
        # Sentinel-2 true color is typically "visual" (alternate: compose b04,b03,b02)
        visual = assets.get("visual") or assets.get("thumbnail") or next(iter(assets.values()), None)
        out.append({
            "id": it.id,
            "datetime": props.get("datetime"),
            "cloud_cover": props.get("eo:cloud_cover"),
            "bbox": it.bbox,
            "geometry": it.geometry,
            "asset_href": visual.href if visual else None,  # COG/thumbnail/etc.
        })
    return out
