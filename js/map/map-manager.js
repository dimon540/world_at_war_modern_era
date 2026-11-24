/* =========================================================
   WORLD AT WAR: MODERN ERA
   MAP MANAGER
   Version: 1.0.0

   Coordinates map data, selection, layers, camera and rendering.
   Rendering and pointer handling are delegated to dedicated modules.
========================================================= */

import { MAP_CONFIG, GAME_CONFIG } from "../config.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const DEFAULT_LAYERS = Object.freeze({
    political: true,
    provinces: true,
    terrain: false,
    rivers: false,
    supply: false,
    resources: false,
    infrastructure: false,
    military: false,
    airZones: false,
    navalRegions: false
});

const VALID_MODES = new Set([
    "political",
    "terrain",
    "resources",
    "infrastructure",
    "supply",
    "military",
    "diplomacy"
]);

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value) {
    if (value === undefined || value === null) return null;
    const id = String(value).trim();
    return id.length ? id : null;
}

function validateFeatureCollection(data) {
    if (!isObject(data) || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
        throw new TypeError("Map data must be a GeoJSON FeatureCollection.");
    }

    for (let index = 0; index < data.features.length; index += 1) {
        const feature = data.features[index];

        if (!isObject(feature) || feature.type !== "Feature") {
            throw new TypeError(`Invalid GeoJSON feature at index ${index}.`);
        }
        if (!isObject(feature.geometry) || !Array.isArray(feature.geometry.coordinates)) {
            throw new TypeError(`Feature at index ${index} has invalid geometry.`);
        }
        if (!["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
            throw new TypeError(`Unsupported geometry type at feature index ${index}.`);
        }
    }

    return data;
}

export class MapManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.map || !state?.world) {
            throw new TypeError("MapManager requires a valid game state.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            background: MAP_CONFIG.background,
            countryBorder: MAP_CONFIG.countryBorder,
            provinceBorder: MAP_CONFIG.provinceBorder,
            selectedCountry: MAP_CONFIG.selectedCountry,
            selectedProvince: MAP_CONFIG.selectedProvince,
            ...options
        };

        this.canvas = null;
        this.context = null;
        this.renderer = null;
        this.interaction = null;
        this.features = [];
        this.featureIndex = new Map();
        this.initialized = false;
        this.destroyed = false;
        this.renderRequested = false;
        this.unsubscribers = [];
        this.camera = {
            x: Number(state.map.camera?.x) || 0,
            y: Number(state.map.camera?.y) || 0,
            zoom: Number(state.map.camera?.zoom) || 1,
            minZoom: Number(state.map.camera?.minZoom) || 0.5,
            maxZoom: Number(state.map.camera?.maxZoom) || 20
        };
        this.layers = { ...DEFAULT_LAYERS, ...(state.map.layers ?? {}) };
        this.mode = VALID_MODES.has(state.map.currentMode)
            ? state.map.currentMode
            : (GAME_CONFIG.map.defaultMode || "political");

        this.#subscribeToWorldEvents();
    }

    initialize(canvas, options = {}) {
        this.#ensureActive();

        if (!canvas || typeof canvas.getContext !== "function") {
            throw new TypeError("MapManager.initialize requires a canvas element.");
        }

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("The browser could not create a 2D map context.");
        }

        this.canvas = canvas;
        this.context = context;

        if (options.renderer) this.setRenderer(options.renderer);
        if (options.interaction) this.setInteraction(options.interaction);

        const source = options.data ?? this.state.map.geoJSON;
        if (source) this.setData(source);

        this.initialized = true;
        this.state.map.initialized = true;
        this.requestRender("initialized");

        return this;
    }

    setRenderer(renderer) {
        this.#ensureActive();
        if (!renderer || typeof renderer.render !== "function") {
            throw new TypeError("Map renderer must provide a render() method.");
        }
        this.renderer = renderer;
        return this;
    }

    setInteraction(interaction) {
        this.#ensureActive();
        if (!interaction) {
            throw new TypeError("Map interaction handler is required.");
        }
        this.interaction = interaction;

        if (typeof interaction.initialize === "function" && this.canvas) {
            interaction.initialize(this.canvas, this);
        }
        return this;
    }

    setData(data) {
        this.#ensureActive();
        const collection = validateFeatureCollection(data);

        const nextIndex = new Map();
        collection.features.forEach((feature, index) => {
            const id = normalizeId(
                feature.id ??
                feature.properties?.id ??
                feature.properties?.ID ??
                feature.properties?.adm1_code ??
                feature.properties?.iso_3166_2 ??
                feature.properties?.code
            );

            if (id) {
                if (nextIndex.has(id)) {
                    throw new Error(`Duplicate map feature identifier: "${id}".`);
                }
                nextIndex.set(id, feature);
            } else {
                nextIndex.set(`feature_${index + 1}`, feature);
            }
        });

        this.features = collection.features.slice();
        this.featureIndex = nextIndex;
        this.state.map.geoJSON = collection;
        this.requestRender("data_changed");

        this.#emit(GAME_EVENTS.MAP_UPDATED, {
            reason: "data_loaded",
            featureCount: this.features.length
        });

        return this.features.length;
    }

    getFeature(featureId) {
        const id = normalizeId(featureId);
        return id ? (this.featureIndex.get(id) ?? null) : null;
    }

    getFeatures() {
        return this.features.slice();
    }

    selectCountry(countryId, options = {}) {
        this.#ensureActive();
        const id = normalizeId(countryId);

        if (id && !this.state.world.countries?.[id]) {
            return false;
        }

        this.state.map.selectedCountryId = id;
        this.state.player.countryId = options.setPlayer === false
            ? this.state.player.countryId
            : id;
        this.state.player.isCountrySelected = Boolean(this.state.player.countryId);

        if (options.emit !== false) {
            this.#emit(GAME_EVENTS.COUNTRY_SELECTED, { countryId: id });
        }

        this.requestRender("country_selected");
        return true;
    }

    selectProvince(provinceId, options = {}) {
        this.#ensureActive();
        const id = normalizeId(provinceId);

        if (id && !this.state.world.provinces?.[id]) {
            return false;
        }

        this.state.map.selectedProvinceId = id;

        if (options.emit !== false) {
            this.#emit(GAME_EVENTS.MAP_UPDATED, {
                reason: "province_selected",
                provinceId: id
            });
        }

        this.requestRender("province_selected");
        return true;
    }

    setMode(mode) {
        this.#ensureActive();
        if (!VALID_MODES.has(mode)) {
            throw new RangeError(`Unsupported map mode: ${mode}`);
        }

        this.mode = mode;
        this.state.map.currentMode = mode;
        this.requestRender("mode_changed");
        this.#emit(GAME_EVENTS.MAP_UPDATED, { reason: "mode_changed", mode });
        return mode;
    }

    setLayer(layerName, enabled) {
        this.#ensureActive();
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_LAYERS, layerName)) {
            throw new RangeError(`Unknown map layer: ${layerName}`);
        }

        this.layers[layerName] = Boolean(enabled);
        this.state.map.layers[layerName] = Boolean(enabled);
        this.requestRender("layer_changed");
        this.#emit(GAME_EVENTS.MAP_UPDATED, {
            reason: "layer_changed",
            layer: layerName,
            enabled: Boolean(enabled)
        });
        return this.layers[layerName];
    }

    toggleLayer(layerName) {
        if (!Object.prototype.hasOwnProperty.call(this.layers, layerName)) {
            throw new RangeError(`Unknown map layer: ${layerName}`);
        }
        return this.setLayer(layerName, !this.layers[layerName]);
    }

    setCamera(patch = {}) {
        this.#ensureActive();
        if (!isObject(patch)) {
            throw new TypeError("Camera update must be an object.");
        }

        const next = { ...this.camera };
        for (const key of ["x", "y", "zoom"]) {
            if (patch[key] !== undefined) {
                const value = Number(patch[key]);
                if (!Number.isFinite(value)) {
                    throw new TypeError(`Camera ${key} must be a finite number.`);
                }
                next[key] = value;
            }
        }

        next.zoom = Math.min(next.maxZoom, Math.max(next.minZoom, next.zoom));
        this.camera = next;
        this.state.map.camera = { ...next };
        this.requestRender("camera_changed");
        return { ...this.camera };
    }

    zoomBy(factor, anchor = null) {
        this.#ensureActive();
        const multiplier = Number(factor);
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new RangeError("Zoom factor must be a positive finite number.");
        }

        const oldZoom = this.camera.zoom;
        const newZoom = Math.min(
            this.camera.maxZoom,
            Math.max(this.camera.minZoom, oldZoom * multiplier)
        );

        let x = this.camera.x;
        let y = this.camera.y;

        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const ratio = newZoom / oldZoom;
            x = anchor.x - (anchor.x - x) * ratio;
            y = anchor.y - (anchor.y - y) * ratio;
        }

        return this.setCamera({ x, y, zoom: newZoom });
    }

    requestRender(reason = "manual") {
        if (this.destroyed) return false;
        if (!this.initialized || !this.renderer) {
            this.renderRequested = true;
            return false;
        }

        this.renderer.render({
            canvas: this.canvas,
            context: this.context,
            state: this.state,
            features: this.features,
            featureIndex: this.featureIndex,
            mode: this.mode,
            layers: { ...this.layers },
            camera: { ...this.camera },
            options: this.options,
            reason
        });

        this.renderRequested = false;
        return true;
    }

    getSnapshot() {
        return {
            initialized: this.initialized,
            featureCount: this.features.length,
            selectedCountryId: this.state.map.selectedCountryId ?? null,
            selectedProvinceId: this.state.map.selectedProvinceId ?? null,
            mode: this.mode,
            layers: { ...this.layers },
            camera: { ...this.camera }
        };
    }

    #subscribeToWorldEvents() {
        if (typeof this.eventBus?.on !== "function") return;

        const refreshEvents = [
            GAME_EVENTS.WORLD_LOADED,
            GAME_EVENTS.WORLD_UPDATED,
            GAME_EVENTS.COUNTRY_UPDATED,
            GAME_EVENTS.PROVINCE_UPDATED,
            GAME_EVENTS.PROVINCE_OWNER_CHANGED,
            GAME_EVENTS.PROVINCE_CONTROLLER_CHANGED
        ];

        for (const eventName of refreshEvents) {
            if (!eventName) continue;
            const unsubscribe = this.eventBus.on(eventName, () => {
                if (eventName === GAME_EVENTS.WORLD_LOADED && this.state.map.geoJSON) {
                    try {
                        this.setData(this.state.map.geoJSON);
                    } catch (error) {
                        this.#emit(GAME_EVENTS.SYSTEM_ERROR, {
                            source: "MapManager",
                            operation: "world_data_refresh",
                            message: error.message
                        });
                    }
                } else {
                    this.requestRender(eventName);
                }
            });

            if (typeof unsubscribe === "function") {
                this.unsubscribers.push(unsubscribe);
            }
        }
    }

    #emit(eventName, payload) {
        if (typeof this.eventBus?.emit !== "function") return;
        this.eventBus.emit(eventName, {
            ...payload,
            timestamp: Date.now()
        });
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("MapManager has been destroyed.");
        }
    }

    destroy() {
        if (this.destroyed) return;

        for (const unsubscribe of this.unsubscribers) {
            try {
                unsubscribe();
            } catch (error) {
                // Continue cleanup even if an external listener was already removed.
            }
        }

        this.unsubscribers.length = 0;

        if (typeof this.interaction?.destroy === "function") {
            this.interaction.destroy();
        }
        if (typeof this.renderer?.destroy === "function") {
            this.renderer.destroy();
        }

        this.canvas = null;
        this.context = null;
        this.renderer = null;
        this.interaction = null;
        this.features = [];
        this.featureIndex.clear();
        this.initialized = false;
        this.state.map.initialized = false;
        this.destroyed = true;
    }
}

export default MapManager;

console.log("WORLD AT WAR: Map Manager module loaded.");
