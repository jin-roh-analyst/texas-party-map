import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bbox from "@turf/bbox";
import booleanIntersects from "@turf/boolean-intersects";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import shp from "shpjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(webRoot, "..");
const rawDir = resolve(root, "data/raw");
const processedDir = resolve(root, "data/processed");
const publicDir = resolve(webRoot, "public/data");

const cityBoundariesPath = resolve(rawDir, "texas-city-boundaries.geojson");
const zctaZipPath = resolve(rawDir, "cb_2020_us_zcta520_500k.zip");
const texasPrecinctsPath = resolve(processedDir, "texas-precincts.geojson");

const CENSUS_YEARS = ["2024", "2023", "2022"];
const DALLAS_NORTH_LAT = 32.7767;
const DALLAS_OPEN_DATA_DOMAIN = "www.dallasopendata.com";
const DALLAS_INCIDENTS_DATASET = "qv6i-rri7";

const CORRIDOR_CITIES = [
  "Addison",
  "Allen",
  "Carrollton",
  "Coppell",
  "Dallas",
  "Farmers Branch",
  "Frisco",
  "Garland",
  "Lewisville",
  "McKinney",
  "Murphy",
  "Plano",
  "Richardson",
  "The Colony",
  "Wylie"
];

const HOUSING_ERAS = [
  ["2020 or later", "B25034_002E"],
  ["2010 to 2019", "B25034_003E"],
  ["2000 to 2009", "B25034_004E"],
  ["1990 to 1999", "B25034_005E"],
  ["1980 to 1989", "B25034_006E"],
  ["1970 to 1979", "B25034_007E"],
  ["1960 to 1969", "B25034_008E"],
  ["1950 to 1959", "B25034_009E"],
  ["1940 to 1949", "B25034_010E"],
  ["1939 or earlier", "B25034_011E"]
];

const ACS_VARIABLES = [
  "NAME",
  "B01003_001E",
  "B01002_001E",
  "B19013_001E",
  "B03002_001E",
  "B03002_003E",
  "B03002_004E",
  "B03002_006E",
  "B03002_012E",
  "B25034_001E",
  ...HOUSING_ERAS.map(([, variable]) => variable)
];

function readEnvFile(path) {
  return fs.readFile(path, "utf8").then((body) => {
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
      }
    }
  }).catch(() => undefined);
}

function numberOrNull(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -1000000) return null;
  return number;
}

function ratio(part, total) {
  if (part === null || total === null || total <= 0) return null;
  return Number((part / total).toFixed(4));
}

function roundRate(count, population) {
  if (!population) return null;
  return Number(((count / population) * 100000).toFixed(1));
}

function boxesIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function zctaId(feature) {
  const props = feature.properties ?? {};
  return String(props.ZCTA5CE20 ?? props.GEOID20 ?? props.GEOID ?? props.ZCTA5CE10 ?? "").padStart(5, "0");
}

function normalizeCityName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function classifyIncident(row) {
  const nibrs = String(row.nibrs_crime ?? "").toUpperCase();
  const offense = String(row.offincident ?? "").toUpperCase();
  const ucr = String(row.ucr_offense ?? "").toUpperCase();
  const weapon = String(row.weaponused ?? "").toUpperCase();
  const text = `${nibrs} ${offense} ${ucr} ${weapon}`;

  return {
    robbery: text.includes("ROBBERY"),
    homicide: text.includes("MURDER") || text.includes("HOMICIDE") || text.includes("MANSLAUGHTER"),
    aggravatedAssault: text.includes("AGGRAVATED ASSAULT"),
    shooting: text.includes("SHOOT") || text.includes("SHOT") || text.includes("FIREARM") || text.includes("HANDGUN") || text.includes("RIFLE")
  };
}

function cityNamesForZcta(zcta, cityIndex) {
  const zctaBox = bbox(zcta);
  const names = [];

  for (const city of cityIndex) {
    if (!boxesIntersect(zctaBox, city.bbox)) continue;
    try {
      if (booleanIntersects(zcta, city.feature)) names.push(city.name);
    } catch {
      continue;
    }
  }

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function buildSearchLabel(zcta, cityNames) {
  if (!cityNames.length) return zcta;
  return `${zcta} ${cityNames.join(" / ")}`;
}

function dominantHousingEra(row) {
  const total = numberOrNull(row.B25034_001E);
  if (!total || total <= 0) return { era: null, share: null };

  let bestEra = null;
  let bestValue = -1;
  for (const [era, variable] of HOUSING_ERAS) {
    const value = numberOrNull(row[variable]) ?? 0;
    if (value > bestValue) {
      bestEra = era;
      bestValue = value;
    }
  }

  return {
    era: bestEra,
    share: Number((bestValue / total).toFixed(4))
  };
}

async function fetchJson(url, headers = {}) {
  let text;

  try {
    const response = await fetch(url, { headers });
    text = await response.text();
    if (!response.ok) {
      throw new Error(`Request failed ${response.status}: ${url}`);
    }
  } catch (error) {
    const args = ["-fL", "-sS"];
    for (const [key, value] of Object.entries(headers)) {
      args.push("-H", `${key}: ${value}`);
    }
    args.push(String(url));

    const result = spawnSync("curl", args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${error.message}; curl fallback failed: ${result.stderr.trim() || `exit ${result.status}`}`);
    }
    text = result.stdout;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON but received: ${text.trim().slice(0, 80).replace(/\s+/g, " ")}`);
  }
}

async function fetchAcsRow(year, zcta) {
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set("get", ACS_VARIABLES.join(","));
  url.searchParams.set("for", `zip code tabulation area:${zcta}`);
  url.searchParams.set("key", process.env.CENSUS_API_KEY);

  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headers = rows[0];
  const values = rows[1];
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

async function fetchAcsData(zctas) {
  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    console.warn("Missing CENSUS_API_KEY in web/.env.local; demographics and housing fields will be marked Needs Review.");
    return { rows: new Map(), year: null };
  }

  const uniqueZctas = [...new Set(zctas)].sort();

  for (const year of CENSUS_YEARS) {
    const output = new Map();
    let failures = 0;

    for (const zcta of uniqueZctas) {
      try {
        const row = await fetchAcsRow(year, zcta);
        if (row) output.set(zcta, row);
      } catch (error) {
        failures += 1;
        if (failures <= 2) {
          console.warn(`Census ACS ${year} failed for ${zcta}: ${error.message}`);
        }
      }
    }

    if (output.size > 0) {
      if (failures > 0) {
        console.warn(`Census ACS ${year}: mapped ${output.size}/${uniqueZctas.length} ZCTAs; ${failures} failed.`);
      }
      return { rows: output, year };
    }
  }

  console.warn("Census ACS requests failed for all configured years; demographics and housing fields will be marked Needs Review.");
  return { rows: new Map(), year: null };
}

async function fetchDallasCrimeData(year) {
  const headers = {};
  if (process.env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  }

  const url = new URL(`https://${DALLAS_OPEN_DATA_DOMAIN}/resource/${DALLAS_INCIDENTS_DATASET}.json`);
  url.searchParams.set("$limit", "50000");
  url.searchParams.set(
    "$select",
    "zip_code,nibrs_crime,ucr_offense,offincident,weaponused,count(*)"
  );
  url.searchParams.set("$where", `zip_code is not null and year1='${year}'`);
  url.searchParams.set("$group", "zip_code,nibrs_crime,ucr_offense,offincident,weaponused");

  let rows;
  try {
    rows = await fetchJson(url, headers);
  } catch (error) {
    console.warn(`Dallas OpenData request failed; safety fields will be marked Needs Review. ${error.message}`);
    return new Map();
  }
  const counts = new Map();

  for (const row of rows) {
    const zip = String(row.zip_code ?? "").slice(0, 5);
    if (!zip) continue;
    const count = Number(row.count ?? row.count_1 ?? 0);
    const existing = counts.get(zip) ?? {
      total: 0,
      robbery: 0,
      homicide: 0,
      aggravated_assault: 0,
      shooting: 0
    };
    const categories = classifyIncident(row);

    existing.total += count;
    if (categories.robbery) existing.robbery += count;
    if (categories.homicide) existing.homicide += count;
    if (categories.aggravatedAssault) existing.aggravated_assault += count;
    if (categories.shooting) existing.shooting += count;
    counts.set(zip, existing);
  }

  return counts;
}

async function main() {
  await readEnvFile(resolve(webRoot, ".env.local"));
  await Promise.all([fs.mkdir(processedDir, { recursive: true }), fs.mkdir(publicDir, { recursive: true })]);

  const [citiesRaw, precinctCollection, crimeByZip] = await Promise.all([
    fs.readFile(cityBoundariesPath, "utf8").then(JSON.parse),
    fs.readFile(texasPrecinctsPath, "utf8").then(JSON.parse),
    fetchDallasCrimeData(new Date().getFullYear() - 1)
  ]);

  const zctaBuffer = await fs.readFile(zctaZipPath);
  const zctaCollection = await shp(zctaBuffer.buffer.slice(zctaBuffer.byteOffset, zctaBuffer.byteOffset + zctaBuffer.byteLength));

  const wantedCities = new Set(CORRIDOR_CITIES.map(normalizeCityName));
  const cityFeatures = citiesRaw.features
    .filter((feature) => feature.geometry && wantedCities.has(normalizeCityName(feature.properties?.city_name)))
    .map((feature) => ({
      name: feature.properties.city_name,
      normalized: normalizeCityName(feature.properties.city_name),
      bbox: bbox(feature),
      feature
    }));

  const selectedZctas = [];
  for (const zcta of zctaCollection.features) {
    if (!zcta.geometry) continue;
    const id = zctaId(zcta);
    const matchedCityNames = cityNamesForZcta(zcta, cityFeatures);
    if (!matchedCityNames.length) continue;

    if (matchedCityNames.includes("Dallas")) {
      const zctaCentroid = centroid(zcta).geometry.coordinates;
      if (zctaCentroid[1] < DALLAS_NORTH_LAT && matchedCityNames.length === 1) continue;
    }

    selectedZctas.push({
      ...zcta,
      properties: {
        zcta: id,
        city_names: matchedCityNames,
        search_label: buildSearchLabel(id, matchedCityNames),
        dem_votes: 0,
        rep_votes: 0,
        total_votes: 0,
        total_major_party_votes: 0,
        dem_share: null,
        rep_share: null,
        margin: null,
        winner: "No matched precinct",
        precincts_assigned: 0,
        population: null,
        median_age: null,
        median_household_income: null,
        white_non_hispanic_share: null,
        black_non_hispanic_share: null,
        asian_non_hispanic_share: null,
        hispanic_share: null,
        housing_units: null,
        dominant_housing_era: null,
        dominant_housing_era_share: null,
        crime_year: new Date().getFullYear() - 1,
        crime_total: null,
        robbery_count: null,
        homicide_count: null,
        aggravated_assault_count: null,
        shooting_count: null,
        violent_crime_rate_per_100k: null,
        robbery_rate_per_100k: null,
        homicide_rate_per_100k: null,
        shooting_rate_per_100k: null,
        politics_status: "Needs Review",
        safety_status: "Needs Review",
        demographics_status: "Needs Review",
        needs_review: true,
        source_label: "ACS 5-year ZCTA, Dallas OpenData incidents, 2024 presidential precinct returns"
      }
    });
  }

  const zctaIndex = selectedZctas.map((zcta, index) => ({
    index,
    bbox: bbox(zcta),
    feature: zcta
  }));

  const acsResult = await fetchAcsData(selectedZctas.map((feature) => feature.properties.zcta));
  const acsRows = acsResult.rows;

  let assignedPrecincts = 0;
  for (const precinct of precinctCollection.features.filter((item) => item.geometry)) {
    const point = centroid(precinct);
    const pointBox = bbox(point);
    const match = zctaIndex
      .filter((zcta) => boxesIntersect(zcta.bbox, pointBox))
      .find((zcta) => booleanPointInPolygon(point, zcta.feature));

    if (!match) continue;

    const target = selectedZctas[match.index].properties;
    const dem = Number(precinct.properties.votes_dem ?? 0);
    const rep = Number(precinct.properties.votes_rep ?? 0);
    const total = Number(precinct.properties.votes_total ?? dem + rep);

    target.dem_votes += dem;
    target.rep_votes += rep;
    target.total_votes += total;
    target.total_major_party_votes += dem + rep;
    target.precincts_assigned += 1;
    assignedPrecincts += 1;
  }

  for (const zcta of selectedZctas) {
    const props = zcta.properties;
    const acs = acsRows.get(props.zcta);
    const crime = crimeByZip.get(props.zcta);

    if (acs) {
      const population = numberOrNull(acs.B01003_001E);
      const raceTotal = numberOrNull(acs.B03002_001E);
      const housing = dominantHousingEra(acs);

      props.population = population;
      props.median_age = numberOrNull(acs.B01002_001E);
      props.median_household_income = numberOrNull(acs.B19013_001E);
      props.white_non_hispanic_share = ratio(numberOrNull(acs.B03002_003E), raceTotal);
      props.black_non_hispanic_share = ratio(numberOrNull(acs.B03002_004E), raceTotal);
      props.asian_non_hispanic_share = ratio(numberOrNull(acs.B03002_006E), raceTotal);
      props.hispanic_share = ratio(numberOrNull(acs.B03002_012E), raceTotal);
      props.housing_units = numberOrNull(acs.B25034_001E);
      props.dominant_housing_era = housing.era;
      props.dominant_housing_era_share = housing.share;
      props.demographics_status = "Mapped";
    }

    if (props.total_major_party_votes > 0) {
      props.dem_share = Number((props.dem_votes / props.total_major_party_votes).toFixed(4));
      props.rep_share = Number((props.rep_votes / props.total_major_party_votes).toFixed(4));
      props.margin = Number((props.dem_share - props.rep_share).toFixed(4));
      props.winner = props.margin >= 0 ? "Democratic" : "Republican";
      props.politics_status = props.total_major_party_votes < 50 ? "Needs Review" : "Mapped";
    }

    if (crime) {
      props.crime_total = crime.total;
      props.robbery_count = crime.robbery;
      props.homicide_count = crime.homicide;
      props.aggravated_assault_count = crime.aggravated_assault;
      props.shooting_count = crime.shooting;
      props.violent_crime_rate_per_100k = roundRate(crime.robbery + crime.homicide + crime.aggravated_assault, props.population);
      props.robbery_rate_per_100k = roundRate(crime.robbery, props.population);
      props.homicide_rate_per_100k = roundRate(crime.homicide, props.population);
      props.shooting_rate_per_100k = roundRate(crime.shooting, props.population);
      props.safety_status = "Dallas OpenData";
    }

    props.needs_review = [props.politics_status, props.safety_status, props.demographics_status].some((status) => status === "Needs Review");
  }

  const output = {
    type: "FeatureCollection",
    features: selectedZctas.sort((a, b) => a.properties.zcta.localeCompare(b.properties.zcta))
  };

  const crimeSourceAudit = {
    generated_at: new Date().toISOString(),
    safety_metric_year: new Date().getFullYear() - 1,
    sources: [
      {
        city: "Dallas",
        status: "Mapped",
        source: "Dallas Police Public Data - RMS Incidents",
        url: `https://${DALLAS_OPEN_DATA_DOMAIN}/resource/${DALLAS_INCIDENTS_DATASET}.json`,
        note: "Grouped by reported ZIP code and classified from NIBRS/UCR/offense/weapon fields."
      },
      ...CORRIDOR_CITIES.filter((city) => city !== "Dallas").map((city) => ({
        city,
        status: "Needs Review",
        source: null,
        url: null,
        note: "No official ZIP-level incident feed has been integrated yet. Do not interpret missing counts as zero crime."
      }))
    ]
  };

  const sources = {
    generated_at: new Date().toISOString(),
    primary_support_metric: "2024 presidential Democratic/Republican major-party vote share by ZCTA",
    caveat: "ZCTAs approximate ZIP code areas. Safety coverage is strongest for Dallas Police incident data and is marked Needs Review elsewhere.",
    sources: [
      {
        label: "U.S. Census ACS 5-year ZCTA data",
        url: `https://api.census.gov/data/${acsResult.year ?? CENSUS_YEARS[0]}/acs/acs5`,
        note: `Used for demographics and housing construction era${acsResult.year ? ` (${acsResult.year} ACS 5-year)` : ""}.`
      },
      {
        label: "U.S. Census 2020 ZCTA cartographic boundaries",
        url: "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
      },
      {
        label: "Dallas Police Public Data - RMS Incidents",
        url: `https://${DALLAS_OPEN_DATA_DOMAIN}/resource/${DALLAS_INCIDENTS_DATASET}.json`,
        note: "Used only where incident records provide ZIP codes."
      },
      {
        label: "New York Times 2024 presidential precinct results and boundaries",
        url: "https://int.nyt.com/newsgraphics/elections/map-data/2024/national/precincts-with-results.topojson.gz"
      },
      {
        label: "Texas Geographic Information Office city boundaries",
        url: "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0/query"
      }
    ]
  };

  const methodology = {
    title: "North Dallas ZIP Intelligence Map Methodology",
    geography: "Census ZIP Code Tabulation Areas intersecting selected North Dallas corridor cities",
    election: "2024 U.S. presidential general election",
    aggregation_method: "Assign each precinct centroid to a ZCTA polygon, then sum Democratic and Republican votes.",
    limitations: [
      "ZCTAs are Census approximations of ZIP delivery areas, not exact USPS ZIP boundaries.",
      "Texas has no official party registration by voter; political support is an election-return proxy.",
      "Dominant housing era is the ACS year-built bin with the largest share of housing units, not a town founding date.",
      "Dallas safety metrics come from reported incident records and preliminary classifications that may change.",
      "Suburb safety metrics are marked Needs Review until official ZIP-level incident feeds are integrated."
    ],
    stats: {
      zctas_total: selectedZctas.length,
      zctas_with_votes: selectedZctas.filter((feature) => feature.properties.total_major_party_votes > 0).length,
      zctas_with_demographics: selectedZctas.filter((feature) => feature.properties.demographics_status === "Mapped").length,
      zctas_with_safety: selectedZctas.filter((feature) => feature.properties.safety_status !== "Needs Review").length,
      texas_precincts_seen: precinctCollection.features.length,
      precincts_assigned_to_zcta: assignedPrecincts
    }
  };

  await fs.writeFile(resolve(processedDir, "zips.geojson"), JSON.stringify(output));
  await fs.writeFile(resolve(publicDir, "zips.geojson"), JSON.stringify(output));
  await fs.writeFile(resolve(publicDir, "sources.json"), JSON.stringify(sources, null, 2));
  await fs.writeFile(resolve(publicDir, "methodology.json"), JSON.stringify(methodology, null, 2));
  await fs.writeFile(resolve(publicDir, "crime-source-audit.json"), JSON.stringify(crimeSourceAudit, null, 2));

  console.log("Built ZCTA data");
  console.log(methodology.stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
