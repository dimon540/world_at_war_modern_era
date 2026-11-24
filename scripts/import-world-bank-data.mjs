import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2000;
const API_ROOT = "https://api.worldbank.org/v2";
const INDICATORS = Object.freeze({
    nominalGDP: { code: "NY.GDP.MKTP.CD", unit: "current US dollars", kind: "economy" },
    realGDP: { code: "NY.GDP.MKTP.KD", unit: "constant 2015 US dollars", kind: "economy" },
    population: { code: "SP.POP.TOTL", unit: "persons", kind: "economy" },
    annualGrowthRate: { code: "NY.GDP.MKTP.KD.ZG", unit: "percent", scale: 0.01, kind: "economy" },
    inflationRate: { code: "FP.CPI.TOTL.ZG", unit: "percent", scale: 0.01, kind: "economy" },
    unemploymentRate: { code: "SL.UEM.TOTL.ZS", unit: "percent", scale: 0.01, kind: "economy" },
    activePersonnel: { code: "MS.MIL.TOTL.P1", unit: "persons", kind: "military" },
});

const finiteOrNull = value => Number.isFinite(value) ? value : null;

export function buildWorldBankDatasets(countryDataset, indicatorRows, retrievedAt = new Date().toISOString()) {
    const countries = countryDataset?.countries;
    if (!Array.isArray(countries) || !countries.length) {
        throw new TypeError("Country catalogue must contain a non-empty countries array.");
    }
    const countryByIso3 = new Map(
        countries.filter(country => typeof country.iso3 === "string" && country.iso3.length === 3)
            .map(country => [country.iso3.toUpperCase(), country])
    );
    const valuesByCountry = new Map();

    for (const [key, definition] of Object.entries(INDICATORS)) {
        const rows = indicatorRows[definition.code];
        if (!Array.isArray(rows)) throw new TypeError("Missing World Bank indicator rows: " + definition.code);
        for (const row of rows) {
            const iso3 = String(row.countryiso3code ?? "").toUpperCase();
            const country = countryByIso3.get(iso3);
            const value = finiteOrNull(row.value);
            if (!country || value === null) continue;
            if (!valuesByCountry.has(country.id)) {
                valuesByCountry.set(country.id, {
                    countryId: country.id,
                    iso3,
                    name: country.name,
                    year: YEAR,
                    indicators: Object.create(null),
                    coverage: Object.create(null)
                });
            }
            const record = valuesByCountry.get(country.id);
            record.indicators[key] = definition.scale ? value * definition.scale : value;
            record.coverage[key] = true;
        }
    }

    const economyCountries = Object.create(null);
    const militaryCountries = Object.create(null);
    for (const [countryId, record] of valuesByCountry) {
        const values = record.indicators;
        if (Number.isFinite(values.nominalGDP) && values.nominalGDP > 0 &&
            Number.isFinite(values.population) && values.population > 0) {
            economyCountries[countryId] = {
                countryId,
                iso3: record.iso3,
                name: record.name,
                year: YEAR,
                nominalGDP: values.nominalGDP,
                realGDP: finiteOrNull(values.realGDP),
                population: values.population,
                annualGrowthRate: finiteOrNull(values.annualGrowthRate),
                inflationRate: finiteOrNull(values.inflationRate),
                unemploymentRate: finiteOrNull(values.unemploymentRate),
                currency: "USD",
                source: "World Bank World Development Indicators",
                asOf: `${YEAR}-01-01`,
                indicatorCodes: Object.fromEntries(
                    Object.entries(INDICATORS)
                        .filter(([, definition]) => definition.kind === "economy")
                        .map(([key, definition]) => [key, definition.code])
                ),
                coverage: Object.fromEntries(
                    ["nominalGDP", "realGDP", "population", "annualGrowthRate", "inflationRate", "unemploymentRate"]
                        .map(key => [key, record.coverage[key] === true])
                )
            };
        }

        if (record.coverage.activePersonnel) {
            militaryCountries[countryId] = {
                countryId,
                iso3: record.iso3,
                name: record.name,
                year: YEAR,
                activePersonnel: finiteOrNull(values.activePersonnel),
                source: "World Bank World Development Indicators; military personnel series sourced from IISS The Military Balance",
                asOf: `${YEAR}-01-01`,
                indicatorCodes: Object.fromEntries(
                    Object.entries(INDICATORS)
                        .filter(([, definition]) => definition.kind === "military")
                        .map(([key, definition]) => [key, definition.code])
                ),
                coverage: Object.fromEntries(
                    ["activePersonnel"]
                        .map(key => [key, record.coverage[key] === true])
                )
            };
        }
    }

    return {
        economy: {
            metadata: {
                dataset: "WORLD AT WAR historical economic baselines",
                scenario: "modern_2000",
                referenceYear: YEAR,
                source: "World Bank World Development Indicators",
                sourceUrl: "https://api.worldbank.org/v2/country/all/indicator/",
                license: "CC BY 4.0",
                retrievedAt,
                missingValues: "Preserved as null; no interpolation or modern-value substitution.",
                indicators: Object.fromEntries(Object.entries(INDICATORS)
                    .filter(([, definition]) => definition.kind === "economy")
                    .map(([key, definition]) => [key, { code: definition.code, unit: definition.unit }]))
            },
            countries: economyCountries
        },
        military: {
            metadata: {
                dataset: "WORLD AT WAR historical military personnel and expenditure",
                scenario: "modern_2000",
                referenceYear: YEAR,
                source: "World Bank World Development Indicators",
                militaryPersonnelSource: "International Institute for Strategic Studies, The Military Balance",
                militaryPersonnelDefinition: "Active-duty armed forces personnel; the source series may include paramilitary forces and does not represent reserve manpower.",
                sourceUrl: "https://databank.worldbank.org/metadataglossary/world-development-indicators/series/MS.MIL.TOTL.P1",
                license: "CC BY 4.0",
                retrievedAt,
                missingValues: "Preserved as null; no interpolation or modern-value substitution.",
                indicators: Object.fromEntries(Object.entries(INDICATORS)
                    .filter(([, definition]) => definition.kind === "military")
                    .map(([key, definition]) => [key, { code: definition.code, unit: definition.unit }]))
            },
            countries: militaryCountries
        }
    };
}

async function fetchIndicatorRows(code, fetchImpl = fetch, { attempts = 3 } = {}) {
    const rows = [];
    let page = 1;
    let pages = 1;
    do {
        const url = new URL(`${API_ROOT}/country/all/indicator/${code}`);
        url.searchParams.set("date", String(YEAR));
        url.searchParams.set("format", "json");
        url.searchParams.set("per_page", "20000");
        url.searchParams.set("page", String(page));
        let response;
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                response = await fetchImpl(url, {
                    headers: { Accept: "application/json" },
                    signal: AbortSignal.timeout(45000)
                });
                if (response.ok) break;
                lastError = new Error(`World Bank API returned HTTP ${response.status} for ${code}.`);
            } catch (error) {
                lastError = error;
            }
            if (attempt + 1 < attempts) {
                await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * (2 ** attempt)));
            }
        }
        if (!response?.ok) throw lastError ?? new Error("World Bank API request failed: " + code);
        const payload = await response.json();
        if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[1])) {
            throw new Error("Unexpected World Bank API response for " + code);
        }
        pages = Number(payload[0].pages) || 1;
        rows.push(...payload[1]);
        page += 1;
    } while (page <= pages);
    return rows;
}

export async function importWorldBankData({ root = ROOT, fetchImpl = fetch } = {}) {
    const countryPath = resolve(root, "data/countries/countries.json");
    const countryDataset = JSON.parse(await readFile(countryPath, "utf8"));
    const entries = Object.entries(INDICATORS);
    const indicatorResults = await Promise.all(entries.map(async ([, definition]) => [
        definition.code,
        await fetchIndicatorRows(definition.code, fetchImpl)
    ]));
    const datasets = buildWorldBankDatasets(
        countryDataset,
        Object.fromEntries(indicatorResults)
    );
    const economyPath = resolve(root, "data/economy/country-baselines-2000.json");
    const militaryPath = resolve(root, "data/military/personnel-2000.json");
    await mkdir(dirname(economyPath), { recursive: true });
    await mkdir(dirname(militaryPath), { recursive: true });
    await Promise.all([
        writeFile(economyPath, JSON.stringify(datasets.economy, null, 2) + "\n", "utf8"),
        writeFile(militaryPath, JSON.stringify(datasets.military, null, 2) + "\n", "utf8")
    ]);
    return {
        economyCountries: Object.keys(datasets.economy.countries).length,
        militaryCountries: Object.keys(datasets.military.countries).length,
        economyPath,
        militaryPath
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const report = await importWorldBankData();
    console.log(JSON.stringify(report, null, 2));
}
