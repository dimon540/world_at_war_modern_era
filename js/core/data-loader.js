
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE DATA LOADER
   Version: 1.0.0

   Responsible for loading and validating world data.

   Supports:
   - Countries
   - Provinces (GeoJSON)
   - Province definitions
   - States
   - Strategic regions
   - Historical country changes
   - Historical border changes
   - Scenario configuration
   - Province ownership

   All loaded data is stored in GameState.
===================================================== */

import { GAME_CONFIG, DATA_PATHS } from "../config.js";

import {
    GAME_EVENTS,
    gameEventBus
} from "./event-bus.js";

import {
    validateGameState
} from "./game-state.js";

/* =====================================================
   CONSTANTS
===================================================== */

export const DATASET_NAMES = Object.freeze([
    "countries",
    "provinces",
    "provinceDefinitions",
    "states",
    "strategicRegions",
    "scenario",
    "ownership",
    "countryHistory",
    "borderHistory"
]);

const REQUIRED_DATASETS = Object.freeze([
    "countries",
    "provinces"
]);

const DEFAULT_CONFIG = Object.freeze({
    baseUrl: "",

    requestTimeout: 30000,

    retries: 2,

    retryDelay: 1000,

    allowMissingOptional: true,

    validateData: true,

    emitProgress: true,

    cacheResponses: true,

    credentials: "same-origin"
});

/* =====================================================
   UTILITIES
===================================================== */

function isObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function delay(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

function resolvePath(path, baseUrl) {

    if (!path || typeof path !== "string") {
        throw new TypeError("Invalid dataset path.");
    }

    if (
        /^https?:\/\//i.test(path) ||
        path.startsWith("/")
    ) {
        return path;
    }

    if (!baseUrl) {
        return path;
    }

    return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function getCollection(data, possibleKeys = []) {

    if (Array.isArray(data)) {
        return data;
    }

    if (!isObject(data)) {
        return [];
    }

    for (const key of possibleKeys) {

        if (Array.isArray(data[key])) {
            return data[key];
        }

        if (isObject(data[key])) {
            return data[key];
        }
    }

    return data;
}

/* =====================================================
   REGISTRY NORMALIZATION
===================================================== */

function createRegistry(data, idFields = ["id"]) {

    const collection = getCollection(data);

    const registry = Object.create(null);

    if (Array.isArray(collection)) {

        for (const item of collection) {

            if (!isObject(item)) {
                continue;
            }

            let id = null;

            for (const field of idFields) {

                if (
                    item[field] !== undefined &&
                    item[field] !== null
                ) {
                    id = String(item[field]);
                    break;
                }
            }

            if (!id) {
                throw new Error(
                    "A dataset entry is missing its unique identifier."
                );
            }

            if (Object.prototype.hasOwnProperty.call(registry, id)) {
                throw new Error(
                    `Duplicate dataset identifier: ${id}`
                );
            }

            registry[id] = item;
        }

        return registry;
    }

    if (isObject(collection)) {

        for (const [id, item] of Object.entries(collection)) {

            if (!isObject(item)) {
                continue;
            }

            registry[id] = {
                ...item,
                id: item.id ?? id
            };
        }
    }

    return registry;
}

/* =====================================================
   GEOJSON NORMALIZATION
===================================================== */

function normalizeGeoJSON(data) {

    if (
        !isObject(data) ||
        data.type !== "FeatureCollection" ||
        !Array.isArray(data.features)
    ) {
        throw new Error(
            "Province data must be a valid GeoJSON FeatureCollection."
        );
    }

    const registry = Object.create(null);

    for (const feature of data.features) {

        if (
            !isObject(feature) ||
            feature.type !== "Feature" ||
            !isObject(feature.properties)
        ) {
            throw new Error(
                "Invalid GeoJSON feature in province dataset."
            );
        }

        const properties = feature.properties;

        const id =
            feature.id ??
            properties.id ??
            properties.province_id ??
            properties.provinceId;

        if (id === undefined || id === null) {
            throw new Error(
                "GeoJSON province is missing a unique identifier."
            );
        }

        const provinceId = String(id);

        if (Object.prototype.hasOwnProperty.call(registry, provinceId)) {
            throw new Error(
                `Duplicate province identifier: ${provinceId}`
            );
        }

        registry[provinceId] = {
            id: provinceId,

            ...properties,

            geometry: feature.geometry,

            featureType: feature.type,

            ownerId: properties.ownerId ?? properties.owner ?? null,

            controllerId:
                properties.controllerId ??
                properties.controller ??
                null
        };
    }

    return registry;
}

/* =====================================================
   DATA LOADER CLASS
===================================================== */

export class DataLoader {

    constructor(state, eventBus = gameEventBus, options = {}) {

        if (!state || !state.world) {
            throw new TypeError(
                "DataLoader requires a valid game state."
            );
        }

        this.state = state;

        this.eventBus = eventBus;

        this.config = {
            ...DEFAULT_CONFIG,
            ...options
        };

        this.cache = new Map();

        this.pendingRequests = new Map();

        this.loadedDatasets = new Set();

        this.failedDatasets = new Map();

        this.loading = false;

        this.destroyed = false;

        this.abortControllers = new Set();

        this.lastReport = null;
    }

    /* ===============================================
       LOAD SINGLE JSON RESOURCE
    =============================================== */

    async loadJSON(path, options = {}) {

        this.#ensureActive();

        const {
            force = false,
            timeout = this.config.requestTimeout
        } = options;

        const url = resolvePath(
            path,
            this.config.baseUrl
        );

        if (
            this.config.cacheResponses &&
            !force &&
            this.cache.has(url)
        ) {
            return this.cache.get(url);
        }

        if (this.pendingRequests.has(url)) {
            return this.pendingRequests.get(url);
        }

        const request = this.#fetchJSON(url, timeout);

        this.pendingRequests.set(url, request);

        try {

            const data = await request;

            if (this.config.cacheResponses) {
                this.cache.set(url, data);
            }

            return data;

        } finally {

            this.pendingRequests.delete(url);

        }
    }

    /* ===============================================
       FETCH WITH RETRIES
    =============================================== */

    async #fetchJSON(url, timeout) {

        let lastError = null;

        for (
            let attempt = 0;
            attempt <= this.config.retries;
            attempt++
        ) {

            this.#ensureActive();

            const controller = new AbortController();

            this.abortControllers.add(controller);

            const timeoutId = setTimeout(() => {
                controller.abort();
            }, timeout);

            try {

                const response = await fetch(url, {
                    method: "GET",

                    headers: {
                        Accept: "application/json"
                    },

                    credentials: this.config.credentials,

                    signal: controller.signal
                });

                if (!response.ok) {

                    throw new Error(
                        `HTTP ${response.status}: ${response.statusText}`
                    );
                }

                const data = await response.json();

                if (
                    data === null ||
                    typeof data !== "object"
                ) {
                    throw new Error(
                        "Server returned invalid JSON data."
                    );
                }

                return data;

            } catch (error) {

                lastError = error;

                if (attempt < this.config.retries) {
                    await delay(
                        this.config.retryDelay * (attempt + 1)
                    );
                }

            } finally {

                clearTimeout(timeoutId);

                this.abortControllers.delete(controller);

            }
        }

        throw new Error(
            `Failed to load ${url}: ${lastError?.message ?? "Unknown error"}`
        );
    }

    /* ===============================================
       LOAD COMPLETE WORLD DATA
    =============================================== */

    async loadWorldData(options = {}) {

        this.#ensureActive();

        if (this.loading) {
            throw new Error(
                "World data loading is already in progress."
            );
        }

        const {
            allowMissingOptional =
                this.config.allowMissingOptional
        } = options;

        this.loading = true;

        const startedAt = Date.now();

        const report = {
            success: false,

            startedAt,

            completedAt: null,

            duration: 0,

            loaded: [],

            missing: [],

            failed: [],

            warnings: [],

            counts: {}
        };

        this.eventBus.emit(
            GAME_EVENTS.WORLD_LOADING,
            {
                scenarioId: GAME_CONFIG.scenario.id
            }
        );

        try {

            const datasets = [
                {
                    name: "countries",
                    path: DATA_PATHS.countries,
                    required: true
                },
                {
                    name: "provinces",
                    path: DATA_PATHS.provinces,
                    required: true
                },
                {
                    name: "provinceDefinitions",
                    path: DATA_PATHS.provinceDefinitions,
                    required: false
                },
                {
                    name: "states",
                    path: DATA_PATHS.states,
                    required: false
                },
                {
                    name: "strategicRegions",
                    path: DATA_PATHS.strategicRegions,
                    required: false
                },
                {
                    name: "scenario",
                    path: DATA_PATHS.scenario,
                    required: false
                },
                {
                    name: "ownership",
                    path: DATA_PATHS.ownership,
                    required: false
                },
                {
                    name: "countryHistory",
                    path: DATA_PATHS.countryHistory,
                    required: false
                },
                {
                    name: "borderHistory",
                    path: DATA_PATHS.borderHistory,
                    required: false
                }
            ];

            const results = Object.create(null);

            for (let index = 0; index < datasets.length; index++) {

                const dataset = datasets[index];

                try {

                    const data = await this.loadJSON(
                        dataset.path
                    );

                    results[dataset.name] = data;

                    report.loaded.push(dataset.name);

                    this.loadedDatasets.add(dataset.name);

                } catch (error) {

                    if (dataset.required || !allowMissingOptional) {

                        report.failed.push({
                            name: dataset.name,
                            message: error.message
                        });

                        throw new Error(
                            `Required dataset failed: ${dataset.name}. ${error.message}`
                        );
                    }

                    report.missing.push(dataset.name);

                    report.warnings.push(
                        `Optional dataset not available: ${dataset.name}`
                    );
                }

                if (this.config.emitProgress) {

                    this.eventBus.emit(
                        GAME_EVENTS.WORLD_UPDATED,
                        {
                            type: "data_loading_progress",

                            current: index + 1,

                            total: datasets.length,

                            dataset: dataset.name,

                            percentage: Math.round(
                                ((index + 1) / datasets.length) * 100
                            )
                        }
                    );
                }
            }

            this.#applyWorldData(results, report);

            report.success = true;

            this.state.status.isInitialized = true;

            this.state.status.phase = GAME_PHASES.READY;

            this.state.metadata.lastUpdatedAt =
                new Date().toISOString();

            this.eventBus.emit(
                GAME_EVENTS.WORLD_LOADED,
                {
                    counts: report.counts,

                    warnings: report.warnings
                }
            );

            return report;

        } catch (error) {

            report.failed.push({
                name: "world",
                message: error.message
            });

            this.eventBus.emit(
                GAME_EVENTS.SYSTEM_ERROR,
                {
                    source: "DataLoader",
                    message: error.message
                }
            );

            throw error;

        } finally {

            report.completedAt = Date.now();

            report.duration =
                report.completedAt - startedAt;

            this.lastReport = report;

            this.loading = false;

        }
    }

    /* ===============================================
       APPLY DATA TO GAME STATE
    =============================================== */

    #applyWorldData(data, report) {

        const countries = createRegistry(
            data.countries,
            ["id", "tag", "iso3", "iso2"]
        );

        const provinces = normalizeGeoJSON(
            data.provinces
        );

        this.state.world.countries = countries;

        this.state.world.provinces = provinces;

        if (data.provinceDefinitions) {

            this.state.world.provinces = {
                ...provinces,

                ...createRegistry(
                    data.provinceDefinitions,
                    ["id", "provinceId"]
                )
            };
        }

        if (data.states) {

            this.state.world.states = createRegistry(
                data.states,
                ["id", "stateId"]
            );
        }

        if (data.strategicRegions) {

            this.state.world.strategicRegions = createRegistry(
                data.strategicRegions,
                ["id", "regionId"]
            );
        }

        if (data.countryHistory) {

            this.state.world.countryHistory =
                data.countryHistory;
        }

        if (data.borderHistory) {

            this.state.world.borderHistory =
                data.borderHistory;
        }

        if (data.scenario) {

            this.#applyScenario(data.scenario);
        }

        if (data.ownership) {

            this.#applyOwnership(data.ownership);
        }

        this.state.world.statistics.totalCountries =
            Object.keys(this.state.world.countries).length;

        this.state.world.statistics.totalProvinces =
            Object.keys(this.state.world.provinces).length;

        this.state.world.statistics.totalStates =
            Object.keys(this.state.world.states).length;

        this.state.world.statistics.totalStrategicRegions =
            Object.keys(this.state.world.strategicRegions).length;

        report.counts = {

            countries:
                this.state.world.statistics.totalCountries,

            provinces:
                this.state.world.statistics.totalProvinces,

            states:
                this.state.world.statistics.totalStates,

            strategicRegions:
                this.state.world.statistics.totalStrategicRegions

        };

        if (this.config.validateData) {

            const validation = validateGameState(
                this.state
            );

            if (!validation.valid) {

                throw new Error(
                    `Game state validation failed: ${validation.errors.join("; ")}`
                );
            }
        }
    }

    /* ===============================================
       APPLY SCENARIO
    =============================================== */

    #applyScenario(scenario) {

        if (!isObject(scenario)) {
            throw new Error("Invalid scenario configuration.");
        }

        const startDate =
            scenario.startDate ??
            scenario.date;

        if (
            startDate &&
            isObject(startDate)
        ) {

            this.state.clock.date = {
                day: startDate.day,
                month: startDate.month,
                year: startDate.year
            };
        }

        if (scenario.id) {

            this.state.metadata.scenarioId =
                scenario.id;
        }

        if (scenario.name) {

            this.state.metadata.scenarioName =
                scenario.name;
        }
    }

    /* ===============================================
       APPLY PROVINCE OWNERSHIP
    =============================================== */

    #applyOwnership(ownership) {

        if (!isObject(ownership)) {
            throw new Error("Invalid ownership dataset.");
        }

        const provinceOwners =
            ownership.provinceOwners ??
            ownership.owners ??
            {};

        const provinceControllers =
            ownership.provinceControllers ??
            ownership.controllers ??
            {};

        if (!isObject(provinceOwners)) {
            throw new Error("Invalid province ownership registry.");
        }

        if (!isObject(provinceControllers)) {
            throw new Error("Invalid province controller registry.");
        }

        this.state.world.ownership.provinceOwners = {
            ...provinceOwners
        };

        this.state.world.ownership.provinceControllers = {
            ...provinceControllers
        };

        for (const [provinceId, ownerId] of Object.entries(provinceOwners)) {

            const province =
                this.state.world.provinces[provinceId];

            if (province) {
                province.ownerId = ownerId;
            }
        }

        for (
            const [provinceId, controllerId]
            of Object.entries(provinceControllers)
        ) {

            const province =
                this.state.world.provinces[provinceId];

            if (province) {
                province.controllerId = controllerId;
            }
        }
    }

    /* ===============================================
       LOAD SINGLE DATASET
    =============================================== */

    async loadDataset(name, options = {}) {

        this.#ensureActive();

        if (!DATASET_NAMES.includes(name)) {
            throw new Error(
                `Unknown dataset: ${name}`
            );
        }

        const path = DATA_PATHS[name];

        if (!path) {
            throw new Error(
                `No path configured for dataset: ${name}`
            );
        }

        const data = await this.loadJSON(path, options);

        this.loadedDatasets.add(name);

        return data;
    }

    /* ===============================================
       CACHE MANAGEMENT
    =============================================== */

    clearCache(path = null) {

        if (path === null) {

            this.cache.clear();

            return;
        }

        const url = resolvePath(
            path,
            this.config.baseUrl
        );

        this.cache.delete(url);
    }

    getLoadedDatasets() {

        return [...this.loadedDatasets];
    }

    getLastReport() {

        return this.lastReport;
    }

    /* ===============================================
       VALIDATION
    =============================================== */

    #ensureActive() {

        if (this.destroyed) {
            throw new Error(
                "DataLoader has been destroyed."
            );
        }
    }

    /* ===============================================
       DESTROY
    =============================================== */

    destroy() {

        if (this.destroyed) {
            return;
        }

        for (const controller of this.abortControllers) {
            controller.abort();
        }

        this.abortControllers.clear();

        this.pendingRequests.clear();

        this.cache.clear();

        this.loadedDatasets.clear();

        this.failedDatasets.clear();

        this.destroyed = true;
    }
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Data Loader module loaded."
);
