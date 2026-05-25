"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { type MapLayerMouseEvent } from "mapbox-gl";
import { AlertTriangle, BarChart3, ExternalLink, Info, MapPin, Search } from "lucide-react";
import type { CityFeature, CityProperties, MethodologyDocument, SourcesDocument } from "../lib/types";

const TEXAS_CENTER: [number, number] = [-99.9018, 31.9686];
const FILL_LAYER_ID = "city-support-fill";
const LINE_LAYER_ID = "city-support-line";
const SOURCE_ID = "cities";

function percent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Needs Review";
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Needs Review";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} pts`;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Needs Review";
  return Number(value).toLocaleString();
}

function winnerClass(winner: string) {
  if (winner === "Democratic") return "dem";
  if (winner === "Republican") return "rep";
  return "review";
}

function getPaintExpression() {
  return [
    "case",
    ["==", ["get", "winner"], "Democratic"],
    [
      "interpolate",
      ["linear"],
      ["abs", ["coalesce", ["get", "margin"], 0]],
      0,
      "#dbeafe",
      0.1,
      "#60a5fa",
      0.25,
      "#2563eb",
      0.5,
      "#1e3a8a"
    ],
    ["==", ["get", "winner"], "Republican"],
    [
      "interpolate",
      ["linear"],
      ["abs", ["coalesce", ["get", "margin"], 0]],
      0,
      "#fee2e2",
      0.1,
      "#f87171",
      0.25,
      "#dc2626",
      0.5,
      "#7f1d1d"
    ],
    "#9ca3af"
  ];
}

function HoverCard({ city }: { city: CityProperties | null }) {
  if (!city) {
    return (
      <aside className="hover-card empty">
        <MapPin size={20} />
        <div>
          <p className="eyebrow">Hover a city</p>
          <h2>Texas support rates</h2>
          <p>Move across the map to inspect 2024 presidential support by city.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hover-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">City support profile</p>
          <h2>{city.city_name}</h2>
        </div>
        <span className={`winner ${winnerClass(city.winner)}`}>{city.winner}</span>
      </div>

      <div className="share-grid">
        <div className="share-card dem">
          <span>Democratic</span>
          <strong>{percent(city.dem_share)}</strong>
          <small>{formatNumber(city.dem_votes)} votes</small>
        </div>
        <div className="share-card rep">
          <span>Republican</span>
          <strong>{percent(city.rep_share)}</strong>
          <small>{formatNumber(city.rep_votes)} votes</small>
        </div>
      </div>

      <dl className="details">
        <div>
          <dt>Margin</dt>
          <dd>{signedPercent(city.margin)}</dd>
        </div>
        <div>
          <dt>Major-party votes</dt>
          <dd>{formatNumber(city.total_major_party_votes)}</dd>
        </div>
        <div>
          <dt>Assigned precincts</dt>
          <dd>{formatNumber(city.precincts_assigned)}</dd>
        </div>
        <div>
          <dt>Data status</dt>
          <dd>{city.needs_review ? "Needs Review" : "Mapped"}</dd>
        </div>
      </dl>

      <p className="method-note">{city.aggregation_method}</p>
    </aside>
  );
}

function MethodologyPanel({
  methodology,
  sources
}: {
  methodology: MethodologyDocument | null;
  sources: SourcesDocument | null;
}) {
  return (
    <section className="methodology">
      <div className="section-title">
        <Info size={18} />
        <h2>Methodology</h2>
      </div>
      <p>
        Texas does not publish party-registration counts because voters do not register by party.
        This map uses 2024 presidential election returns as a support-rate proxy.
      </p>
      {methodology && (
        <div className="method-grid">
          <div>
            <span>Geography</span>
            <strong>{methodology.geography}</strong>
          </div>
          <div>
            <span>Election</span>
            <strong>{methodology.election}</strong>
          </div>
          <div>
            <span>Cities with votes</span>
            <strong>
              {methodology.stats.cities_with_votes.toLocaleString()} / {methodology.stats.cities_total.toLocaleString()}
            </strong>
          </div>
          <div>
            <span>Precincts assigned</span>
            <strong>{methodology.stats.precincts_assigned_to_city.toLocaleString()}</strong>
          </div>
        </div>
      )}
      {methodology && (
        <ul className="limitations">
          {methodology.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {sources && (
        <div className="sources">
          {sources.sources.map((source) => (
            <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
              {source.label}
              <ExternalLink size={13} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [cities, setCities] = useState<GeoJSON.FeatureCollection<GeoJSON.Geometry, CityProperties> | null>(null);
  const [sources, setSources] = useState<SourcesDocument | null>(null);
  const [methodology, setMethodology] = useState<MethodologyDocument | null>(null);
  const [hoveredCity, setHoveredCity] = useState<CityProperties | null>(null);
  const [query, setQuery] = useState("");
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    Promise.all([
      fetch("/data/cities.geojson").then((response) => response.json()),
      fetch("/data/sources.json").then((response) => response.json()),
      fetch("/data/methodology.json").then((response) => response.json())
    ]).then(([cityData, sourceData, methodologyData]) => {
      setCities(cityData);
      setSources(sourceData);
      setMethodology(methodologyData);
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current || !cities || !token || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: TEXAS_CENTER,
      zoom: 5.2,
      minZoom: 4.6,
      maxZoom: 12
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: cities
      });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": getPaintExpression() as mapboxgl.Expression,
          "fill-opacity": [
            "case",
            ["==", ["get", "needs_review"], true],
            0.25,
            0.72
          ] as mapboxgl.Expression
        }
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 9, 1.2] as mapboxgl.Expression
        }
      });

      map.on("mousemove", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0] as CityFeature | undefined;
        if (feature?.properties) {
          setHoveredCity(feature.properties);
        }
      });

      map.on("mouseleave", FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [cities, token]);

  const searchResults = useMemo(() => {
    if (!cities || query.trim().length < 2) return [];
    const normalized = query.trim().toLowerCase();
    return cities.features
      .filter((feature) => feature.properties.city_name.toLowerCase().includes(normalized))
      .sort((a, b) => (b.properties.total_major_party_votes ?? 0) - (a.properties.total_major_party_votes ?? 0))
      .slice(0, 8);
  }, [cities, query]);

  function flyToCity(city: CityFeature) {
    setHoveredCity(city.properties);
    const geometry = city.geometry;
    if (!mapRef.current || !geometry) return;
    const cityBox = city.geometry ? cityBbox(city) : null;
    if (cityBox) {
      mapRef.current.fitBounds(cityBox, {
        padding: 90,
        duration: 900,
        maxZoom: 10
      });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Texas 2024 presidential returns</p>
          <h1>City-level party support map</h1>
          <p>
            Explore Democratic and Republican major-party vote share across incorporated Texas cities.
            Results are aggregated from precinct returns and shown as a support-rate proxy.
          </p>
        </div>
        <div className="hero-stat">
          <BarChart3 size={20} />
          <span>{methodology ? `${methodology.stats.cities_with_votes.toLocaleString()} cities mapped` : "Loading cities"}</span>
        </div>
      </section>

      <section className="workspace">
        <div className="map-panel">
          <div className="map-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search city"
                aria-label="Search city"
              />
            </div>
            <div className="legend">
              <span className="swatch rep-strong" />
              <span>R +25</span>
              <span className="swatch neutral" />
              <span>Even</span>
              <span className="swatch dem-strong" />
              <span>D +25</span>
            </div>
          </div>

          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((city) => (
                <button key={city.properties.geoid} onClick={() => flyToCity(city)}>
                  <span>{city.properties.city_name}</span>
                  <small>{signedPercent(city.properties.margin)}</small>
                </button>
              ))}
            </div>
          )}

          {!token ? (
            <div className="token-warning">
              <AlertTriangle size={24} />
              <h2>Mapbox token required</h2>
              <p>
                Add `NEXT_PUBLIC_MAPBOX_TOKEN` to `web/.env.local`, then restart the dev server.
              </p>
            </div>
          ) : (
            <div ref={mapContainer} className="map-canvas" />
          )}
        </div>

        <div className="side-panel">
          <HoverCard city={hoveredCity} />
          <MethodologyPanel methodology={methodology} sources={sources} />
        </div>
      </section>
    </main>
  );
}

function cityBbox(city: CityFeature): [[number, number], [number, number]] | null {
  const coords: number[][] = [];
  const geometry = city.geometry;

  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;

  function collect(input: unknown) {
    if (!Array.isArray(input)) return;
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      coords.push(input as number[]);
      return;
    }
    for (const item of input) collect(item);
  }

  collect(geometry.coordinates);
  if (!coords.length) return null;

  const lngs = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)]
  ];
}
