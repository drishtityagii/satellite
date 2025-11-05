// src/main.ts
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const map = L.map("map", { center: [37.8, -122.3], zoom: 9 });

// Base map
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Helper: add a COG overlay via TileJSON from your backend
async function addCOG(cogUrl: string) {
  const tilejsonUrl =
    `http://localhost:8000/cog/WebMercatorQuad/tilejson.json?url=` +
    encodeURIComponent(cogUrl);

  const res = await fetch(tilejsonUrl);
  if (!res.ok) {
    console.error("TileJSON fetch failed:", res.status, await res.text());
    alert("Failed to load TileJSON. Check backend logs / CORS.");
    return;
  }

  const tj = await res.json();
  const tilesTemplate: string | undefined = tj.tiles?.[0];
  if (!tilesTemplate) {
    alert("No tiles template in TileJSON response.");
    console.error("TileJSON:", tj);
    return;
  }

  // Add imagery layer
  const imagery = L.tileLayer(tilesTemplate, {
    minZoom: tj.minzoom ?? 0,
    maxZoom: tj.maxzoom ?? 22,
    attribution: tj.attribution ?? "",
    tileSize: 256,
  }).addTo(map);

  // Fit to bounds if provided: [west, south, east, north]
  if (Array.isArray(tj.bounds) && tj.bounds.length === 4) {
    const [w, s, e, n] = tj.bounds;
    map.fitBounds([
      [s, w],
      [n, e],
    ]);
  }

  // Layer control (optional)
  L.control
    .layers({ OpenStreetMap: osm }, { "Sentinel-2 (COG)": imagery }, { collapsed: false })
    .addTo(map);
  console.log("TileJSON response:", tj);
}

// Example known-good Sentinel-2 TCI COG (true color)
const exampleCOG =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/10/S/DH/2025/2/S2B_10SDH_20250225_0_L2A/TCI.tif";
addCOG(exampleCOG);


// Optional: your STAC /search call (different endpoint on :8000)
async function runSearch() {
  const bbox = [-123.1, 37.3, -121.7, 38.2]; // SF Bay approx
  const start = "2025-01-01";
  const end = "2025-02-28";
  const cloud_max = 20;
  const url = new URL("http://localhost:8000/search");
  url.searchParams.set("bbox", bbox.join(","));
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("cloud_max", String(cloud_max));
  url.searchParams.set("limit", "20");

  const res = await fetch(url);
  console.log("Search status:", res.status);
  const data = await res.json();
  console.log("Search results:", data);
}
runSearch();

