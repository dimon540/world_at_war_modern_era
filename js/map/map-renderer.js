/* =========================================================
   WORLD AT WAR: MODERN ERA
   MAP RENDERER
   Version: 1.0.0

   Canvas renderer for the global political map and map layers.
========================================================= */

import { MAP_CONFIG } from "../config.js";

const DEFAULT_OPTIONS = Object.freeze({
    background: MAP_CONFIG.background,
    countryBorder: MAP_CONFIG.countryBorder,
    provinceBorder: MAP_CONFIG.provinceBorder,
    selectedCountry: MAP_CONFIG.selectedCountry,
    selectedProvince: MAP_CONFIG.selectedProvince,
    gridColor: "rgba(177, 198, 207, 0.13)",
    landFallback: "#52616a",
    showGrid: true,
    maxPixelRatio: 2
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function getFeatureId(feature, index) {
    const properties = feature?.properties ?? {};
    const candidates = [
        feature?.id,
        properties.id,
        properties.ID,
        properties.adm1_code,
        properties.iso_3166_2,
        properties.code
    ];

    const candidate = candidates.find(value =>
        value !== undefined && value !== null && String(value).trim() !== ""
    );

    return candidate === undefined ? `feature_${index + 1}` : String(candidate);
}

function getCountryCode(feature) {
    const properties = feature?.properties ?? {};
    const candidates = [
        properties.ADM0_A3,
        properties.adm0_a3,
        properties.ISO_A3,
        properties.iso_a3,
        properties.SOV_A3,
        properties.sov_a3,
        properties.GU_A3,
        properties.gu_a3,
        properties.ADM0_A3_US,
        properties.SU_A3,
        properties.BRK_A3,
        properties.ISO3,
        properties.iso3,
        properties.country_code
    ];

    const value = candidates.find(item =>
        typeof item === "string" &&
        item.trim() !== "" &&
        item.trim() !== "-99"
    );

    return value ? value.trim().toUpperCase() : null;
}

function resolveCountry(state, feature, featureId) {
    const countries = state?.world?.countries ?? {};
    const code = getCountryCode(feature);

    if (code) {
        for (const country of Object.values(countries)) {
            if (
                country?.id === code ||
                country?.iso3 === code ||
                country?.iso2 === code ||
                country?.tag === code
            ) {
                return country;
            }
        }
    }

    const ownerRegistry = state?.world?.ownership?.provinceOwners ?? {};
    const ownerId = ownerRegistry[featureId];

    if (ownerId && countries[ownerId]) {
        return countries[ownerId];
    }

    return null;
}

function stableColor(value) {
    const input = String(value ?? "unknown");
    let hash = 2166136261;

    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    const hue = (hash >>> 0) % 360;
    return `hsl(${hue} 27% 39%)`;
}

function projectCoordinate(coordinate, transform) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;

    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
    }

    const lon = clamp(longitude, -540, 540);
    const lat = clamp(latitude, -89.9, 89.9);

    return {
        x: transform.centerX + lon * transform.scale + transform.offsetX,
        y: transform.centerY - lat * transform.scale + transform.offsetY
    };
}

function traceRing(context, ring, transform) {
    if (!Array.isArray(ring) || ring.length < 3) return false;

    let started = false;
    for (const coordinate of ring) {
        const point = projectCoordinate(coordinate, transform);
        if (!point) continue;

        if (!started) {
            context.moveTo(point.x, point.y);
            started = true;
        } else {
            context.lineTo(point.x, point.y);
        }
    }

    if (started) context.closePath();
    return started;
}

function traceGeometry(context, geometry, transform) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return false;

    let traced = false;

    if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) {
            traced = traceRing(context, ring, transform) || traced;
        }
    } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates) {
            if (!Array.isArray(polygon)) continue;
            for (const ring of polygon) {
                traced = traceRing(context, ring, transform) || traced;
            }
        }
    }

    return traced;
}

function getFeatureName(feature) {
    const properties = feature?.properties ?? {};
    return properties.name ??
        properties.NAME_1 ??
        properties.NAME ??
        properties.ADMIN ??
        properties.admin ??
        "Unmapped region";
}

export class MapRenderer {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.destroyed = false;
        this.lastRender = null;
        this.renderCount = 0;
    }

    render(payload = {}) {
        if (this.destroyed) {
            throw new Error("MapRenderer has been destroyed.");
        }

        const { canvas, context, state, features = [] } = payload;

        if (!canvas || !context || !state?.map) {
            throw new TypeError("MapRenderer.render requires canvas, context and game state.");
        }

        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
        const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 1));
        const pixelRatio = clamp(
            Number(globalThis.devicePixelRatio) || 1,
            1,
            this.options.maxPixelRatio
        );

        const targetWidth = Math.max(1, Math.floor(width * pixelRatio));
        const targetHeight = Math.max(1, Math.floor(height * pixelRatio));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = this.options.background;
        context.fillRect(0, 0, width, height);

        const camera = payload.camera ?? state.map.camera ?? {};
        const zoom = clamp(
            isFiniteNumber(camera.zoom) ? Number(camera.zoom) : 1,
            0.5,
            20
        );
        const baseScale = Math.min(width / 360, height / 180);
        const transform = {
            centerX: width / 2,
            centerY: height / 2,
            scale: baseScale * zoom,
            offsetX: Number(camera.x) || 0,
            offsetY: Number(camera.y) || 0
        };

        if (this.options.showGrid) {
            this.#drawGrid(context, width, height, transform);
        }

        const layers = payload.layers ?? state.map.layers ?? {};
        const mode = payload.mode ?? state.map.currentMode ?? "political";
        const selectedCountryId = state.map.selectedCountryId ??
            state.player?.countryId ?? null;
        const selectedProvinceId = state.map.selectedProvinceId ?? null;

        let drawnFeatures = 0;
        let selectedFeatures = 0;

        for (let index = 0; index < features.length; index += 1) {
            const feature = features[index];
            const geometry = feature?.geometry;
            if (!geometry) continue;

            const featureId = getFeatureId(feature, index);
            const country = resolveCountry(state, feature, featureId);
            const countryId = country?.id ?? country?.iso3 ?? country?.iso2 ?? null;
            const isSelectedCountry = Boolean(
                selectedCountryId &&
                (selectedCountryId === countryId ||
                 selectedCountryId === country?.iso3 ||
                 selectedCountryId === country?.iso2)
            );
            const isSelectedProvince = selectedProvinceId === featureId;

            context.beginPath();
            if (!traceGeometry(context, geometry, transform)) continue;

            const fill = this.#getFillColor({
                mode,
                layers,
                feature,
                featureId,
                country,
                countryId,
                isSelectedCountry
            });

            context.fillStyle = isSelectedProvince
                ? this.options.selectedProvince
                : isSelectedCountry
                    ? this.options.selectedCountry
                    : fill;

            try {
                context.fill("evenodd");
            } catch (error) {
                context.fill();
            }

            if (layers.provinces !== false) {
                context.strokeStyle = this.options.provinceBorder;
                context.lineWidth = clamp(0.55 * zoom, 0.35, 1.5);
                context.stroke();
            }

            if (isSelectedCountry || isSelectedProvince) {
                context.strokeStyle = isSelectedProvince
                    ? "#fff1bd"
                    : "#f1d99c";
                context.lineWidth = clamp(1.35 * zoom, 1.1, 3);
                context.stroke();
                selectedFeatures += 1;
            }

            drawnFeatures += 1;
        }

        this.#drawFrame(context, width, height);

        this.renderCount += 1;
        this.lastRender = {
            timestamp: Date.now(),
            width,
            height,
            featureCount: features.length,
            drawnFeatures,
            selectedFeatures,
            mode,
            zoom
        };

        return this.lastRender;
    }

    #getFillColor({ mode, layers, feature, featureId, country, countryId, isSelectedCountry }) {
        if (isSelectedCountry) return this.options.selectedCountry;

        if (mode === "terrain" || layers.terrain) {
            const terrain = feature?.properties?.terrain ??
                feature?.properties?.featurecla ??
                feature?.properties?.type;
            return stableColor(terrain || "terrain");
        }

        if (mode === "resources" || layers.resources) {
            const resource = feature?.properties?.resource ??
                feature?.properties?.resources;
            return resource ? stableColor(resource) : "#46545a";
        }

        if (mode === "infrastructure" || layers.infrastructure) {
            const infrastructure = feature?.properties?.infrastructure;
            return infrastructure ? "#9b875c" : "#46545a";
        }

        if (mode === "supply" || layers.supply) {
            const supply = feature?.properties?.supply_level;
            return isFiniteNumber(supply)
                ? `hsl(145 38% ${clamp(Number(supply), 18, 65)}%)`
                : "#46545a";
        }

        if (mode === "military" || layers.military) {
            const presence = feature?.properties?.military_presence;
            return presence ? "#87534c" : "#46545a";
        }

        if (mode === "diplomacy") {
            return countryId ? stableColor(countryId) : this.options.landFallback;
        }

        return country
            ? stableColor(country.id ?? country.iso3 ?? countryId)
            : stableColor(getFeatureName(feature) || featureId);
    }

    #drawGrid(context, width, height, transform) {
        context.save();
        context.strokeStyle = this.options.gridColor;
        context.lineWidth = 1;
        context.beginPath();

        for (let longitude = -180; longitude <= 180; longitude += 30) {
            const x = transform.centerX + longitude * transform.scale + transform.offsetX;
            context.moveTo(x, 0);
            context.lineTo(x, height);
        }

        for (let latitude = -60; latitude <= 60; latitude += 30) {
            const y = transform.centerY - latitude * transform.scale + transform.offsetY;
            context.moveTo(0, y);
            context.lineTo(width, y);
        }

        context.stroke();
        context.restore();
    }

    #drawFrame(context, width, height) {
        context.save();
        context.strokeStyle = "rgba(190, 207, 215, 0.22)";
        context.lineWidth = 1;
        context.strokeRect(0.5, 0.5, width - 1, height - 1);
        context.restore();
    }

    getStatus() {
        return {
            destroyed: this.destroyed,
            renderCount: this.renderCount,
            lastRender: this.lastRender ? { ...this.lastRender } : null
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.lastRender = null;
        this.destroyed = true;
    }
}

export default MapRenderer;

console.log("WORLD AT WAR: Map Renderer module loaded.");
