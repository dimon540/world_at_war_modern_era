/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY STATISTICS
   Version: 1.0.0

   Read-only statistics, rankings and country comparisons.
   Missing historical values remain null; this module never
   invents population, GDP, military strength or other data.
========================================================= */

const METRICS = Object.freeze({
    population: {
        label: "Population",
        unit: "people",
        paths: ["statistics.population", "population.total", "demographics.population", "population"]
    },
    gdp: {
        label: "GDP",
        unit: "USD",
        paths: ["statistics.gdp", "economy.gdp", "economy.nominalGDP", "gdp"]
    },
    gdpPerCapita: {
        label: "GDP per capita",
        unit: "USD/person",
        paths: ["statistics.gdpPerCapita", "economy.gdpPerCapita", "gdpPerCapita"]
    },
    militaryPersonnel: {
        label: "Military personnel",
        unit: "people",
        paths: ["statistics.militaryPersonnel", "military.personnel", "military.manpower", "militaryPersonnel"]
    },
    divisions: {
        label: "Divisions",
        unit: "divisions",
        paths: ["statistics.divisions", "military.divisions", "divisions"]
    },
    factories: {
        label: "Factories",
        unit: "factories",
        paths: ["statistics.factories", "industry.totalFactories", "economy.factories", "factories"]
    },
    stability: {
        label: "Stability",
        unit: "%",
        paths: ["statistics.stability", "politics.stability", "stability"]
    },
    literacy: {
        label: "Literacy",
        unit: "%",
        paths: ["statistics.literacy", "demographics.literacy", "literacy"]
    }
});

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPath(source, path) {
    let value = source;
    for (const key of path.split(".")) {
        if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, key)) {
            return undefined;
        }
        value = value[key];
    }
    return value;
}

function numericValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.replaceAll(",", ""));
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function resolveMetric(country, definition) {
    for (const path of definition.paths) {
        const value = numericValue(readPath(country, path));
        if (value !== null) return value;
    }
    return null;
}

function formatNumber(value, maximumFractionDigits = 1) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits,
        notation: Math.abs(value) >= 1e12 ? "compact" : "standard"
    }).format(value);
}

export class CountryStatistics {
    constructor(state, countryManager = null, options = {}) {
        if (!state?.world?.countries || !isRecord(state.world.countries)) {
            throw new TypeError("CountryStatistics requires the loaded country registry.");
        }
        this.state = state;
        this.countryManager = countryManager;
        this.options = { includeAnnexed: true, ...options };
        this.destroyed = false;
    }

    #ensureActive() {
        if (this.destroyed) throw new Error("CountryStatistics has been destroyed.");
    }

    #getCountry(countryId) {
        const id = String(countryId ?? "").trim();
        if (!id) return null;
        if (this.countryManager?.getCountry) return this.countryManager.getCountry(id);
        return this.state.world.countries[id] ?? null;
    }

    #getCountries(options = {}) {
        const includeAnnexed = options.includeAnnexed ?? this.options.includeAnnexed;
        const countries = this.countryManager?.getAllCountries
            ? this.countryManager.getAllCountries({ includeEliminated: includeAnnexed })
            : Object.values(this.state.world.countries);

        return countries.filter(country =>
            isRecord(country) &&
            (includeAnnexed || country.gameStatus !== "annexed")
        );
    }

    getMetric(countryId, metricId) {
        this.#ensureActive();
        const definition = METRICS[metricId];
        if (!definition) throw new RangeError(`Unknown country metric: ${metricId}`);
        const country = this.#getCountry(countryId);
        if (!country) return null;

        return {
            countryId: country.id ?? String(countryId),
            metric: metricId,
            label: definition.label,
            unit: definition.unit,
            value: resolveMetric(country, definition)
        };
    }

    getCountryStatistics(countryId) {
        this.#ensureActive();
        const country = this.#getCountry(countryId);
        if (!country) return null;

        const metrics = {};
        for (const [metricId, definition] of Object.entries(METRICS)) {
            metrics[metricId] = {
                label: definition.label,
                unit: definition.unit,
                value: resolveMetric(country, definition)
            };
        }

        return {
            countryId: country.id ?? String(countryId),
            name: country.name ?? country.officialName ?? String(countryId),
            capital: country.capital ?? null,
            region: country.region ?? null,
            politicalStatus: country.status ?? null,
            gameStatus: country.gameStatus ?? null,
            metrics
        };
    }

    getWorldStatistics(options = {}) {
        this.#ensureActive();
        const countries = this.#getCountries(options);
        const metrics = {};

        for (const [metricId, definition] of Object.entries(METRICS)) {
            const values = countries
                .map(country => resolveMetric(country, definition))
                .filter(value => value !== null);
            const total = values.length
                ? values.reduce((sum, value) => sum + value, 0)
                : null;

            metrics[metricId] = {
                label: definition.label,
                unit: definition.unit,
                total,
                average: total === null ? null : total / values.length,
                countriesWithData: values.length,
                countriesWithoutData: countries.length - values.length
            };
        }

        return {
            countryCount: countries.length,
            metrics,
            dataCoverage: Object.fromEntries(
                Object.entries(metrics).map(([id, metric]) => [
                    id,
                    countries.length ? metric.countriesWithData / countries.length : 0
                ])
            )
        };
    }

    getRanking(metricId, options = {}) {
        this.#ensureActive();
        const definition = METRICS[metricId];
        if (!definition) throw new RangeError(`Unknown country metric: ${metricId}`);

        const direction = options.direction ?? "desc";
        if (direction !== "asc" && direction !== "desc") {
            throw new RangeError("Ranking direction must be 'asc' or 'desc'.");
        }

        const limit = options.limit === undefined ? Infinity : Number(options.limit);
        if (!(limit > 0)) throw new RangeError("Ranking limit must be a positive number.");

        const rows = this.#getCountries(options)
            .map(country => ({
                countryId: country.id,
                name: country.name ?? country.officialName ?? country.id,
                region: country.region ?? null,
                value: resolveMetric(country, definition),
                unit: definition.unit
            }))
            .filter(row => row.value !== null)
            .sort((a, b) => direction === "desc"
                ? b.value - a.value || a.name.localeCompare(b.name)
                : a.value - b.value || a.name.localeCompare(b.name));

        return rows.slice(0, limit).map((row, index) => ({
            rank: index + 1,
            ...row
        }));
    }

    compareCountries(countryIds, metricIds = Object.keys(METRICS)) {
        this.#ensureActive();
        if (!Array.isArray(countryIds) || countryIds.length < 2) {
            throw new TypeError("Country comparison requires at least two country IDs.");
        }
        if (!Array.isArray(metricIds)) {
            throw new TypeError("Metric IDs must be an array.");
        }

        const countries = countryIds.map(id => {
            const country = this.#getCountry(id);
            if (!country) throw new RangeError(`Unknown country: ${id}`);
            return country;
        });

        const metrics = {};
        for (const metricId of metricIds) {
            const definition = METRICS[metricId];
            if (!definition) throw new RangeError(`Unknown country metric: ${metricId}`);
            metrics[metricId] = {
                label: definition.label,
                unit: definition.unit,
                values: countries.map(country => ({
                    countryId: country.id,
                    name: country.name ?? country.officialName ?? country.id,
                    value: resolveMetric(country, definition)
                }))
            };
        }

        return {
            countries: countries.map(country => ({
                id: country.id,
                name: country.name ?? country.officialName ?? country.id
            })),
            metrics
        };
    }

    getAvailableMetrics() {
        this.#ensureActive();
        return Object.entries(METRICS).map(([id, definition]) => ({
            id,
            label: definition.label,
            unit: definition.unit
        }));
    }

    getSnapshot() {
        this.#ensureActive();
        const countries = this.#getCountries();
        return {
            countries: countries.length,
            availableMetrics: Object.keys(METRICS),
            selectedCountryId: this.state.player?.countryId ?? null,
            world: this.getWorldStatistics()
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.state = null;
        this.countryManager = null;
        this.destroyed = true;
    }
}

export default CountryStatistics;

console.log("WORLD AT WAR: Country Statistics module loaded.");
