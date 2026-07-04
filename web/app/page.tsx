"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { type MapLayerMouseEvent } from "mapbox-gl";
import {
  AlertTriangle,
  BarChart3,
  ExternalLink,
  Home as HomeIcon,
  Info,
  MapPin,
  Search,
  Shield,
  Users,
  type LucideIcon
} from "lucide-react";
import type { MethodologyDocument, SourcesDocument, ZipFeature, ZipProperties } from "../lib/types";

const NORTH_DALLAS_CENTER: [number, number] = [-96.78, 33.05];
const FILL_LAYER_ID = "zip-intelligence-fill";
const LINE_LAYER_ID = "zip-intelligence-line";
const SOURCE_ID = "zips";

type LayerMode = "politics" | "safety" | "housing" | "demographics";

const layerOptions: Array<{ id: LayerMode; label: string; icon: LucideIcon }> = [
  { id: "politics", label: "Political", icon: BarChart3 },
  { id: "safety", label: "Safety", icon: Shield },
  { id: "housing", label: "Housing", icon: HomeIcon },
  { id: "demographics", label: "Demographics", icon: Users }
];

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

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Needs Review";
  return `$${Number(value).toLocaleString()}`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Needs Review";
  return `${Number(value).toLocaleString()} / 100k`;
}

function winnerClass(winner: string) {
  if (winner === "Democratic") return "dem";
  if (winner === "Republican") return "rep";
  return "review";
}

function paintExpression(mode: LayerMode) {
  if (mode === "safety") {
    return [
      "case",
      ["!=", ["get", "safety_status"], "Needs Review"],
      [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "violent_crime_rate_per_100k"], 0],
        0,
        "#ecfdf5",
        300,
        "#a7f3d0",
        700,
        "#facc15",
        1200,
        "#f97316",
        2000,
        "#991b1b"
      ],
      "#9ca3af"
    ];
  }

  if (mode === "housing") {
    return [
      "match",
      ["get", "dominant_housing_era"],
      "2020 or later",
      "#0f766e",
      "2010 to 2019",
      "#14b8a6",
      "2000 to 2009",
      "#22c55e",
      "1990 to 1999",
      "#84cc16",
      "1980 to 1989",
      "#eab308",
      "1970 to 1979",
      "#f59e0b",
      "1960 to 1969",
      "#f97316",
      "1950 to 1959",
      "#ea580c",
      "1940 to 1949",
      "#c2410c",
      "1939 or earlier",
      "#7c2d12",
      "#9ca3af"
    ];
  }

  if (mode === "demographics") {
    return [
      "case",
      ["!=", ["get", "demographics_status"], "Needs Review"],
      [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "population"], 0],
        0,
        "#f8fafc",
        10000,
        "#c7d2fe",
        30000,
        "#818cf8",
        60000,
        "#4f46e5",
        100000,
        "#312e81"
      ],
      "#9ca3af"
    ];
  }

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

function legend(mode: LayerMode) {
  if (mode === "safety") {
    return (
      <>
        <span className="swatch safety-low" />
        <span>Lower rate</span>
        <span className="swatch safety-high" />
        <span>Higher rate</span>
      </>
    );
  }

  if (mode === "housing") {
    return (
      <>
        <span className="swatch housing-new" />
        <span>Newer</span>
        <span className="swatch housing-old" />
        <span>Older</span>
      </>
    );
  }

  if (mode === "demographics") {
    return (
      <>
        <span className="swatch pop-low" />
        <span>Lower pop.</span>
        <span className="swatch pop-high" />
        <span>Higher pop.</span>
      </>
    );
  }

  return (
    <>
      <span className="swatch rep-strong" />
      <span>R +25</span>
      <span className="swatch neutral" />
      <span>Even</span>
      <span className="swatch dem-strong" />
      <span>D +25</span>
    </>
  );
}

function ZipCard({ zip }: { zip: ZipProperties | null }) {
  if (!zip) {
    return (
      <aside className="hover-card empty">
        <MapPin size={20} />
        <div>
          <p className="eyebrow">Hover a ZIP</p>
          <h2>North Dallas ZIP intelligence</h2>
          <p>Move across the map to inspect political support, safety, housing era, and demographics by ZCTA.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hover-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">ZCTA profile</p>
          <h2>{zip.zcta}</h2>
          <p className="subline">{zip.city_names.join(" / ") || "Needs Review"}</p>
        </div>
        <span className={`winner ${winnerClass(zip.winner)}`}>{zip.winner}</span>
      </div>

      <div className="share-grid">
        <div className="share-card dem">
          <span>Democratic</span>
          <strong>{percent(zip.dem_share)}</strong>
          <small>{formatNumber(zip.dem_votes)} votes</small>
        </div>
        <div className="share-card rep">
          <span>Republican</span>
          <strong>{percent(zip.rep_share)}</strong>
          <small>{formatNumber(zip.rep_votes)} votes</small>
        </div>
      </div>

      <dl className="details">
        <div>
          <dt>Margin</dt>
          <dd>{signedPercent(zip.margin)}</dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd>{formatNumber(zip.population)}</dd>
        </div>
        <div>
          <dt>Dominant housing era</dt>
          <dd>{zip.dominant_housing_era ?? "Needs Review"}</dd>
        </div>
        <div>
          <dt>Era share</dt>
          <dd>{percent(zip.dominant_housing_era_share)}</dd>
        </div>
        <div>
          <dt>Median household income</dt>
          <dd>{formatMoney(zip.median_household_income)}</dd>
        </div>
        <div>
          <dt>Median age</dt>
          <dd>{formatNumber(zip.median_age)}</dd>
        </div>
      </dl>

      <div className="metric-band">
        <div>
          <span>Violent rate</span>
          <strong>{formatRate(zip.violent_crime_rate_per_100k)}</strong>
        </div>
        <div>
          <span>Robbery</span>
          <strong>{formatNumber(zip.robbery_count)}</strong>
        </div>
        <div>
          <span>Homicide</span>
          <strong>{formatNumber(zip.homicide_count)}</strong>
        </div>
        <div>
          <span>Shooting/firearm</span>
          <strong>{formatNumber(zip.shooting_count)}</strong>
        </div>
      </div>

      <dl className="details compact">
        <div>
          <dt>Hispanic</dt>
          <dd>{percent(zip.hispanic_share)}</dd>
        </div>
        <div>
          <dt>Asian NH</dt>
          <dd>{percent(zip.asian_non_hispanic_share)}</dd>
        </div>
        <div>
          <dt>Black NH</dt>
          <dd>{percent(zip.black_non_hispanic_share)}</dd>
        </div>
        <div>
          <dt>White NH</dt>
          <dd>{percent(zip.white_non_hispanic_share)}</dd>
        </div>
      </dl>

      <p className="method-note">
        Safety: {zip.safety_status}. Politics: {zip.politics_status}. Demographics: {zip.demographics_status}.
      </p>
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
        ZIPs are represented by Census ZCTAs. Political support uses 2024 presidential precinct returns, while
        safety coverage is mapped only where official ZIP-level incident data is available.
      </p>
      {methodology && (
        <div className="method-grid">
          <div>
            <span>ZCTAs</span>
            <strong>{formatNumber(methodology.stats.zctas_total)}</strong>
          </div>
          <div>
            <span>With safety</span>
            <strong>{formatNumber(methodology.stats.zctas_with_safety)}</strong>
          </div>
          <div>
            <span>With votes</span>
            <strong>{formatNumber(methodology.stats.zctas_with_votes)}</strong>
          </div>
          <div>
            <span>Precincts assigned</span>
            <strong>{formatNumber(methodology.stats.precincts_assigned_to_zcta)}</strong>
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
  const [zips, setZips] = useState<GeoJSON.FeatureCollection<GeoJSON.Geometry, ZipProperties> | null>(null);
  const [sources, setSources] = useState<SourcesDocument | null>(null);
  const [methodology, setMethodology] = useState<MethodologyDocument | null>(null);
  const [hoveredZip, setHoveredZip] = useState<ZipProperties | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<LayerMode>("politics");
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    Promise.all([
      fetch("/data/zips.geojson").then((response) => response.json()),
      fetch("/data/sources.json").then((response) => response.json()),
      fetch("/data/methodology.json").then((response) => response.json())
    ]).then(([zipData, sourceData, methodologyData]) => {
      setZips(zipData);
      setSources(sourceData);
      setMethodology(methodologyData);
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(FILL_LAYER_ID)) return;
    map.setPaintProperty(FILL_LAYER_ID, "fill-color", paintExpression(mode) as mapboxgl.Expression);
  }, [mode]);

  useEffect(() => {
    if (!mapContainer.current || !zips || !token || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: NORTH_DALLAS_CENTER,
      zoom: 8.7,
      minZoom: 7.2,
      maxZoom: 13
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: zips
      });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": paintExpression(mode) as mapboxgl.Expression,
          "fill-opacity": [
            "case",
            ["==", ["get", "needs_review"], true],
            0.58,
            0.76
          ] as mapboxgl.Expression
        }
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.75,
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.45, 11, 1.4] as mapboxgl.Expression
        }
      });

      map.on("mousemove", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0] as ZipFeature | undefined;
        if (feature?.properties) {
          const parsed = {
            ...feature.properties,
            city_names: Array.isArray(feature.properties.city_names)
              ? feature.properties.city_names
              : JSON.parse(String(feature.properties.city_names ?? "[]"))
          };
          setHoveredZip(parsed);
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
  }, [zips, token, mode]);

  const searchResults = useMemo(() => {
    if (!zips || query.trim().length < 2) return [];
    const normalized = query.trim().toLowerCase();
    return zips.features
      .filter((feature) => feature.properties.search_label.toLowerCase().includes(normalized))
      .sort((a, b) => (b.properties.population ?? 0) - (a.properties.population ?? 0))
      .slice(0, 8);
  }, [zips, query]);

  function flyToZip(zip: ZipFeature) {
    setHoveredZip(zip.properties);
    const zipBox = featureBbox(zip);
    if (!mapRef.current || !zipBox) return;
    mapRef.current.fitBounds(zipBox, {
      padding: 90,
      duration: 900,
      maxZoom: 11
    });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">North Dallas corridor</p>
          <h1>ZIP intelligence map</h1>
          <p>
            Explore political support, safety indicators, housing-era signals, and demographics across North Dallas
            and surrounding suburbs. ZIPs are represented by Census ZCTAs.
          </p>
        </div>
        <div className="hero-stat">
          <BarChart3 size={20} />
          <span>{methodology ? `${formatNumber(methodology.stats.zctas_total)} ZCTAs mapped` : "Loading ZCTAs"}</span>
        </div>
      </section>

      <section className="workspace">
        <div className="map-panel">
          <div className="map-toolbar">
            <div className="toolbar-left">
              <div className="search-box">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search ZIP or city"
                  aria-label="Search ZIP or city"
                />
              </div>
              <div className="layer-tabs" aria-label="Map layer">
                {layerOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      className={mode === option.id ? "active" : ""}
                      onClick={() => setMode(option.id)}
                      type="button"
                    >
                      <Icon size={15} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="legend">{legend(mode)}</div>
          </div>

          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((zip) => (
                <button key={zip.properties.zcta} onClick={() => flyToZip(zip)}>
                  <span>{zip.properties.zcta}</span>
                  <small>{zip.properties.city_names.join(" / ")}</small>
                </button>
              ))}
            </div>
          )}

          {!token ? (
            <div className="token-warning">
              <AlertTriangle size={24} />
              <h2>Mapbox token required</h2>
              <p>Add `NEXT_PUBLIC_MAPBOX_TOKEN` to `web/.env.local`, then restart the dev server.</p>
            </div>
          ) : (
            <div ref={mapContainer} className="map-canvas" />
          )}
        </div>

        <div className="side-panel">
          <ZipCard zip={hoveredZip} />
          <MethodologyPanel methodology={methodology} sources={sources} />
        </div>
      </section>
    </main>
  );
}

function featureBbox(feature: ZipFeature): [[number, number], [number, number]] | null {
  const coords: number[][] = [];
  const geometry = feature.geometry;

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
