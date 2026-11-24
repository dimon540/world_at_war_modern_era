/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE DATA LOADER
   Version: 1.0.2

   Loads and validates the historical world dataset.
===================================================== */

import { DATA_PATHS } from "../config.js";
import {
    GAME_EVENTS,
    gameEventBus
} from "./event-bus.js";
import {
    validateGameState,
    markGameStateDirty
} from "./game-state.js";

const DEFAULT_CONFIG = Object.freeze({
    requiredDatasets: ["countries", "provinces"],
    fetchOptions: {
        cache: "no-cache",
        credentials: "same-origin"
    },
    validateState: true,
    emitEvents: true
});

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getCollection(data, preferredKeys = []) {
    if (Array.isArray(data)) return data;
    if (!isObject(data)) return [];
    for (const key of preferredKeys) {
        if (Array.isArray(data[key])) return data[key];
    }
    return [];
}

function getFeatureId(feature, index) {
    const properties = feature?.properties ?? {};
    const candidates = [
        feature?.id,
        properties.id,
        properties.ID,
        properties.adm1_code,
        properties.iso_3166_2,
        properties.code,
        properties.name,
        properties.NAME_1
    ];
    const value = candidates.find(item =>
        item !== undefined && item !== null && String(item).trim() !== ""
    );
    return value === undefined ? `province_${index + 1}` : String(value);
}

function toRegistry(items, idResolver) {
    const registry = Object.create(null);
    items.forEach((item, index) => {
        if (!isObject(item)) return;
        const id = idResolver(item, index);
        if (id) registry[String(id)] = item;
    });
    return registry;
}

export class DataLoader {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state || !state.world) {
            throw new TypeError("DataLoader requires a valid game state.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.config = {
            ...DEFAULT_CONFIG,
            ...options,
            fetchOptions: {
                ...DEFAULT_CONFIG.fetchOptions,
                ...(options.fetchOptions ?? {})
            }
        };

        this.loading = false;
        this.destroyed = false;
        this.lastReport = null;
        this.activeRequests = new Map();
    }

    async loadWorldData(options = {}) {
        this.#ensureActive();

        if (this.loading) {
            throw new Error("World data is already being loaded.");
        }

        this.loading = true;
        const startedAt = Date.now();
        const required = options.requiredDatasets ??
            this.config.requiredDatasets;

        this.#emit(GAME_EVENTS.WORLD_LOADING, {
            datasets: [...required],
            startedAt
        });

        try {
            const countriesPath = options.paths?.countries ?? DATA_PATHS.countries;
            const provincesPath = options.paths?.provinces ?? DATA_PATHS.provinces;

            if (!countriesPath || !provincesPath) {
                throw new Error("Required world data paths are not configured.");
            }

            const [countriesData, provincesData] = await Promise.all([
                this.loadJSON(countriesPath, { required: required.includes("countries") }),
                this.loadJSON(provincesPath, { required: required.includes("provinces") })
            ]);

            if (!countriesData || !provincesData) {
                throw new Error("Required country or province dataset is missing.");
            }

            const countryItems = getCollection(countriesData, [
                "countries", "items", "data"
            ]);
            const provinceItems = provincesData.type === "FeatureCollection"
                ? (Array.isArray(provincesData.features) ? provincesData.features : [])
                : getCollection(provincesData, ["provinces", "features", "items", "data"]);

            if (countryItems.length === 0) {
                throw new Error("Country dataset contains no countries.");
            }
            if (provinceItems.length === 0) {
                throw new Error("Province dataset contains no features.");
            }

            this.#applyWorldData(countryItems, provinceItems, countriesData, provincesData);

            if (this.config.validateState) {
                const validation = validateGameState(this.state);
                if (!validation.valid) {
                    throw new Error(
                        "Game state validation failed: " + validation.errors.join(" ")
                    );
                }
            }

            this.state.status.isInitialized = true;
            this.state.status.isRunning = false;
            this.state.status.isPaused = true;
            this.state.metadata.lastUpdatedAt = new Date().toISOString();

            if (typeof markGameStateDirty === "function") {
                markGameStateDirty(this.state);
            }

            const report = {
                success: true,
                loadedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                countries: countryItems.length,
                provinces: provinceItems.length,
                datasets: ["countries", "provinces"]
            };

            this.lastReport = report;
            this.#emit(GAME_EVENTS.WORLD_LOADED, report);
            return report;
        } catch (error) {
            const report = {
                success: false,
                durationMs: Date.now() - startedAt,
                error: error.message
            };
            this.lastReport = report;
            this.#emit(GAME_EVENTS.SYSTEM_ERROR, {
                source: "DataLoader",
                operation: "loadWorldData",
                message: error.message
            });
            throw error;
        } finally {
            this.loading = false;
            this.activeRequests.clear();
        }
    }

    async loadDataset(name, path, options = {}) {
        this.#ensureActive();

        if (typeof name !== "string" || !name.trim()) {
            throw new TypeError("Dataset name must be a non-empty string.");
        }

        const resolvedPath = path ?? DATA_PATHS[name];
        if (!resolvedPath) {
            if (options.required) {
                throw new Error(`No path configured for required dataset "${name}".`);
            }
            return null;
        }

        return this.loadJSON(resolvedPath, options);
    }

    async loadJSON(path, options = {}) {
        this.#ensureActive();

        if (typeof path !== "string" || !path.trim()) {
            if (options.required) throw new TypeError("A valid data path is required.");
            return null;
        }

        const key = String(path);
        if (this.activeRequests.has(key)) {
            return this.activeRequests.get(key);
        }

        const request = (async () => {
            let response;
            try {
                response = await fetch(key, {
                    ...this.config.fetchOptions,
                    ...(options.fetchOptions ?? {})
                });
            } catch (error) {
                if (!options.required) return null;
                throw new Error(`Network error while loading "${key}": ${error.message}`);
            }

            if (!response.ok) {
                if (!options.required && response.status === 404) return null;
                throw new Error(
                    `Failed to load "${key}": HTTP ${response.status} ${response.statusText}`
                );
            }

            try {
                return await response.json();
            } catch (error) {
                throw new Error(`Invalid JSON in "${key}": ${error.message}`);
            }
        })();

        this.activeRequests.set(key, request);
        try {
            return await request;
        } finally {
            this.activeRequests.delete(key);
        }
    }

    #applyWorldData(countries, provinces, countriesSource, provincesSource) {
        this.state.world.countries = toRegistry(
            countries,
            (country, index) => country.id ?? country.iso3 ?? country.iso2 ?? country.tag ?? `country_${index + 1}`
        );

        this.state.world.provinces = toRegistry(
            provinces,
            (feature, index) => getFeatureId(feature, index)
        );

        this.state.world.statistics.totalCountries =
            Object.keys(this.state.world.countries).length;
        this.state.world.statistics.totalProvinces =
            Object.keys(this.state.world.provinces).length;

        this.state.statistics.totalCountries =
            this.state.world.statistics.totalCountries;
        this.state.statistics.totalProvinces =
            this.state.world.statistics.totalProvinces;

        this.state.map.geoJSON = provincesSource;
        this.state.map.countryData = countriesSource;

        if (!this.state.world.ownership) {
            this.state.world.ownership = {
                provinceOwners: Object.create(null),
                provinceControllers: Object.create(null)
            };
        }
    }

    getStatus() {
        return {
            loading: this.loading,
            destroyed: this.destroyed,
            lastReport: this.lastReport
        };
    }

    #emit(eventName, payload) {
        if (!this.config.emitEvents || !eventName || !this.eventBus?.emit) return;
        this.eventBus.emit(eventName, {
            ...payload,
            timestamp: Date.now()
        });
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("DataLoader has been destroyed.");
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.activeRequests.clear();
        this.destroyed = true;
    }
}

console.log("WORLD AT WAR: Data Loader module loaded.");
