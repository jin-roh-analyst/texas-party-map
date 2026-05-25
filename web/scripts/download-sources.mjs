import { createWriteStream, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(webRoot, "..");
const rawDir = resolve(root, "data/raw");

const sources = [
  {
    label: "New York Times 2024 presidential precinct results and boundaries",
    url: "https://int.nyt.com/newsgraphics/elections/map-data/2024/national/precincts-with-results.topojson.gz",
    local: resolve(rawDir, "nyt-precincts-with-results.topojson.gz")
  },
  {
    label: "Texas Geographic Information Office city boundaries",
    url: "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true&outSR=4326",
    local: resolve(rawDir, "texas-city-boundaries.geojson")
  }
];

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function download(url, destination) {
  return new Promise((resolveDownload, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "texas-party-map/0.1" } },
      (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
          download(response.headers.location, destination).then(resolveDownload, reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed ${response.statusCode}: ${url}`));
          return;
        }

        pipeline(response, createWriteStream(destination)).then(resolveDownload, reject);
      }
    );
    request.on("error", reject);
  });
}

await fs.mkdir(rawDir, { recursive: true });

for (const source of sources) {
  if (await exists(source.local)) {
    console.log(`Using cached ${source.label}`);
  } else {
    console.log(`Downloading ${source.label}`);
    await download(source.url, source.local);
  }
}
