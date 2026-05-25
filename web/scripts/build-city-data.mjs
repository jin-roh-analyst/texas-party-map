import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import centroid from "@turf/centroid";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import bbox from "@turf/bbox";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(webRoot, "..");
const rawDir = resolve(root, "data/raw");
const processedDir = resolve(root, "data/processed");
const publicDir = resolve(webRoot, "public/data");
const texasPrecinctsPath = resolve(processedDir, "texas-precincts.geojson");

const SOURCES = {
  nytTopojson: {
    label: "New York Times 2024 presidential precinct results and boundaries",
    url: "https://int.nyt.com/newsgraphics/elections/map-data/2024/national/precincts-with-results.topojson.gz",
    local: resolve(rawDir, "nyt-precincts-with-results.topojson.gz")
  },
  texasCities: {
    label: "Texas Geographic Information Office city boundaries",
    url: "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true&outSR=4326",
    local: resolve(rawDir, "texas-city-boundaries.geojson")
  }
};

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeCityFeature(featureItem) {
  const props = featureItem.properties ?? {};
  return {
    ...featureItem,
    properties: {
      city_name: props.city_name,
      geoid: props.geo_id,
      geoid_fq: props.geo_id_fq,
      pop_est_2020: Number(props.popest2020 ?? 0),
      dem_votes: 0,
      rep_votes: 0,
      total_votes: 0,
      total_major_party_votes: 0,
      dem_share: null,
      rep_share: null,
      margin: null,
      winner: "No matched precinct",
      precincts_assigned: 0,
      needs_review: true,
      aggregation_method: "Precinct centroid assigned to containing Texas city boundary",
      source_label: "2024 presidential precinct returns"
    }
  };
}

function boxesIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cityColorProps(city) {
  const props = city.properties;
  if (!props.total_major_party_votes) {
    props.dem_share = null;
    props.rep_share = null;
    props.margin = null;
    props.winner = "Needs Review";
    props.needs_review = true;
    return;
  }

  props.dem_share = props.dem_votes / props.total_major_party_votes;
  props.rep_share = props.rep_votes / props.total_major_party_votes;
  props.margin = props.dem_share - props.rep_share;
  props.winner = props.margin >= 0 ? "Democratic" : "Republican";
  props.needs_review = props.precincts_assigned === 0 || props.total_major_party_votes < 50;
}

async function main() {
  await Promise.all([fs.mkdir(processedDir, { recursive: true }), fs.mkdir(publicDir, { recursive: true })]);

  for (const source of Object.values(SOURCES)) {
    if (!(await exists(source.local))) {
      throw new Error(`Missing source file. Run npm run data from web/: ${source.local}`);
    }
  }

  console.log("Reading city boundaries");
  const citiesRaw = JSON.parse(await fs.readFile(SOURCES.texasCities.local, "utf8"));
  const cityFeatures = citiesRaw.features
    .filter((item) => item.geometry && item.properties?.city_name)
    .map(normalizeCityFeature);

  const cityIndex = cityFeatures.map((city, index) => ({
    index,
    bbox: bbox(city),
    feature: city
  }));

  if (!(await exists(texasPrecinctsPath))) {
    throw new Error(`Missing Texas precinct GeoJSON. Run scripts/extract-texas-precincts.py first: ${texasPrecinctsPath}`);
  }

  console.log("Reading Texas precinct GeoJSON");
  const precinctCollection = JSON.parse(await fs.readFile(texasPrecinctsPath, "utf8"));
  const texasPrecincts = precinctCollection.features.filter((item) => item.geometry);

  console.log(`Aggregating ${texasPrecincts.length.toLocaleString()} Texas precincts into ${cityFeatures.length.toLocaleString()} city boundaries`);
  let assigned = 0;

  for (const precinct of texasPrecincts) {
    const precinctBox = bbox(precinct);
    const point = centroid(precinct);
    const candidates = cityIndex.filter((city) => boxesIntersect(city.bbox, precinctBox));
    const match = candidates.find((city) => booleanPointInPolygon(point, city.feature));

    if (!match) continue;

    const target = cityFeatures[match.index].properties;
    const dem = Number(precinct.properties.votes_dem ?? 0);
    const rep = Number(precinct.properties.votes_rep ?? 0);
    const total = Number(precinct.properties.votes_total ?? dem + rep);

    target.dem_votes += dem;
    target.rep_votes += rep;
    target.total_votes += total;
    target.total_major_party_votes += dem + rep;
    target.precincts_assigned += 1;
    assigned += 1;
  }

  for (const city of cityFeatures) {
    cityColorProps(city);
    for (const key of ["dem_share", "rep_share", "margin"]) {
      if (typeof city.properties[key] === "number") {
        city.properties[key] = Number(city.properties[key].toFixed(4));
      }
    }
  }

  const output = {
    type: "FeatureCollection",
    features: cityFeatures
  };

  const sources = {
    generated_at: new Date().toISOString(),
    primary_support_metric: "2024 presidential Democratic/Republican major-party vote share",
    caveat: "Texas does not register voters by party; this is an election-return proxy, not official party registration.",
    sources: [
      SOURCES.nytTopojson,
      SOURCES.texasCities,
      {
        label: "Texas Capitol Data Portal 2024 General VTD data",
        url: "https://data.capitol.texas.gov/topic/about/elections",
        note: "Preferred official refresh source when available. Site returned HTTP 503 during initial build attempt on 2026-05-25."
      }
    ].map(({ label, url, note }) => ({ label, url, note }))
  };

  const methodology = {
    title: "Texas Party Support Map Methodology",
    geography: "Texas incorporated city boundaries",
    election: "2024 U.S. presidential general election",
    aggregation_method: "Assign each precinct to the city polygon containing its centroid, then sum Democratic and Republican votes.",
    limitations: [
      "Texas has no official party registration by voter.",
      "City-level support is an approximation because precinct boundaries do not perfectly align with city boundaries.",
      "ZIP/ZCTA support is not included in v1 because election returns are not natively ZIP-based.",
      "Cities with no assigned precinct centroid or low vote totals are marked Needs Review."
    ],
    stats: {
      texas_precincts_seen: texasPrecincts.length,
      precincts_assigned_to_city: assigned,
      cities_total: cityFeatures.length,
      cities_with_votes: cityFeatures.filter((city) => city.properties.total_major_party_votes > 0).length
    }
  };

  await fs.writeFile(resolve(processedDir, "cities.geojson"), JSON.stringify(output));
  await fs.writeFile(resolve(publicDir, "cities.geojson"), JSON.stringify(output));
  await fs.writeFile(resolve(publicDir, "sources.json"), JSON.stringify(sources, null, 2));
  await fs.writeFile(resolve(publicDir, "methodology.json"), JSON.stringify(methodology, null, 2));

  console.log("Done");
  console.log(methodology.stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
