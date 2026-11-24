/* =========================================================
   WORLD AT WAR: MODERN ERA
   MAP CAMERA
   Version: 1.0.0

   Camera controls and geographic/screen coordinate conversion.
   MapManager remains the authoritative owner of camera state.
========================================================= */

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function validateSize(width, height) {
    const w = Number(width);
    const h = Number(height);

    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new RangeError("Map camera viewport dimensions must be positive numbers.");
    }

    return { width: w, height: h };
}

export class MapCamera {
    constructor(mapManager, options = {}) {
        if (
            !mapManager ||
            typeof mapManager.setCamera !== "function" ||
            typeof mapManager.zoomBy !== "function"
        ) {
            throw new TypeError("MapCamera requires a compatible MapManager.");
        }

        this.mapManager = mapManager;
        this.options = {
            minZoom: 0.5,
            maxZoom: 20,
            defaultZoom: 1,
            fitPadding: 28,
            ...options
        };

        this.destroyed = false;
    }

    get camera() {
        this.#ensureActive();
        return { ...this.mapManager.camera };
    }

    get zoom() {
        return this.camera.zoom;
    }

    get x() {
        return this.camera.x;
    }

    get y() {
        return this.camera.y;
    }

    setPosition(x, y) {
        this.#ensureActive();
        return this.mapManager.setCamera({
            x: finite(x, this.mapManager.camera.x),
            y: finite(y, this.mapManager.camera.y)
        });
    }

    panBy(deltaX, deltaY) {
        this.#ensureActive();
        const camera = this.mapManager.camera;

        return this.mapManager.setCamera({
            x: camera.x + finite(deltaX),
            y: camera.y + finite(deltaY)
        });
    }

    setZoom(zoom, anchor = null) {
        this.#ensureActive();

        const camera = this.mapManager.camera;
        const requested = Number(zoom);

        if (!Number.isFinite(requested) || requested <= 0) {
            throw new RangeError("Camera zoom must be a positive finite number.");
        }

        const minZoom = Math.max(
            finite(camera.minZoom, this.options.minZoom),
            this.options.minZoom
        );
        const maxZoom = Math.min(
            finite(camera.maxZoom, this.options.maxZoom),
            this.options.maxZoom
        );
        const nextZoom = clamp(requested, minZoom, maxZoom);

        return this.mapManager.zoomBy(nextZoom / camera.zoom, anchor);
    }

    zoomIn(factor = 1.2, anchor = null) {
        this.#ensureActive();
        const multiplier = Number(factor);

        if (!Number.isFinite(multiplier) || multiplier <= 1) {
            throw new RangeError("Zoom-in factor must be greater than 1.");
        }

        return this.setZoom(this.mapManager.camera.zoom * multiplier, anchor);
    }

    zoomOut(factor = 1.2, anchor = null) {
        this.#ensureActive();
        const multiplier = Number(factor);

        if (!Number.isFinite(multiplier) || multiplier <= 1) {
            throw new RangeError("Zoom-out factor must be greater than 1.");
        }

        return this.setZoom(this.mapManager.camera.zoom / multiplier, anchor);
    }

    zoomAt(factor, screenPoint) {
        this.#ensureActive();

        if (
            !screenPoint ||
            !Number.isFinite(Number(screenPoint.x)) ||
            !Number.isFinite(Number(screenPoint.y))
        ) {
            throw new TypeError("zoomAt requires a valid screen point.");
        }

        return this.mapManager.zoomBy(factor, {
            x: Number(screenPoint.x),
            y: Number(screenPoint.y)
        });
    }

    reset() {
        this.#ensureActive();

        return this.mapManager.setCamera({
            x: 0,
            y: 0,
            zoom: clamp(
                this.options.defaultZoom,
                this.options.minZoom,
                this.options.maxZoom
            )
        });
    }

    centerOn(longitude, latitude, viewport = null) {
        this.#ensureActive();

        const lon = Number(longitude);
        const lat = Number(latitude);

        if (
            !Number.isFinite(lon) ||
            !Number.isFinite(lat) ||
            lon < -180 ||
            lon > 180 ||
            lat < -90 ||
            lat > 90
        ) {
            throw new RangeError("Center coordinates must be valid longitude and latitude.");
        }

        const size = this.#resolveViewport(viewport);
        const camera = this.mapManager.camera;
        const scale = Math.min(size.width / 360, size.height / 180) * camera.zoom;

        return this.mapManager.setCamera({
            x: -lon * scale,
            y: lat * scale
        });
    }

    fitBounds(bounds, viewport = null, options = {}) {
        this.#ensureActive();

        if (!bounds || typeof bounds !== "object") {
            throw new TypeError("fitBounds requires geographic bounds.");
        }

        const west = Number(bounds.west ?? bounds.minLon ?? bounds[0]);
        const south = Number(bounds.south ?? bounds.minLat ?? bounds[1]);
        const east = Number(bounds.east ?? bounds.maxLon ?? bounds[2]);
        const north = Number(bounds.north ?? bounds.maxLat ?? bounds[3]);

        if (
            ![west, south, east, north].every(Number.isFinite) ||
            west < -180 || east > 180 ||
            south < -90 || north > 90 ||
            east <= west || north <= south
        ) {
            throw new RangeError("fitBounds received invalid geographic bounds.");
        }

        const size = this.#resolveViewport(viewport);
        const padding = Math.max(0, finite(options.padding, this.options.fitPadding));
        const availableWidth = Math.max(1, size.width - padding * 2);
        const availableHeight = Math.max(1, size.height - padding * 2);
        const baseScale = Math.min(size.width / 360, size.height / 180);
        const longitudeSpan = east - west;
        const latitudeSpan = north - south;

        const zoomForWidth = availableWidth / (longitudeSpan * baseScale);
        const zoomForHeight = availableHeight / (latitudeSpan * baseScale);
        const requestedZoom = Math.min(zoomForWidth, zoomForHeight);

        const camera = this.mapManager.camera;
        const minZoom = Math.max(
            finite(camera.minZoom, this.options.minZoom),
            this.options.minZoom
        );
        const maxZoom = Math.min(
            finite(camera.maxZoom, this.options.maxZoom),
            this.options.maxZoom
        );
        const zoom = clamp(requestedZoom, minZoom, maxZoom);
        const centerLongitude = (west + east) / 2;
        const centerLatitude = (south + north) / 2;
        const scale = baseScale * zoom;

        return this.mapManager.setCamera({
            x: -centerLongitude * scale,
            y: centerLatitude * scale,
            zoom
        });
    }

    project(longitude, latitude, viewport = null) {
        this.#ensureActive();

        const lon = Number(longitude);
        const lat = Number(latitude);

        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            throw new TypeError("project requires finite longitude and latitude.");
        }

        const size = this.#resolveViewport(viewport);
        const camera = this.mapManager.camera;
        const scale = Math.min(size.width / 360, size.height / 180) * camera.zoom;

        return {
            x: size.width / 2 + lon * scale + camera.x,
            y: size.height / 2 - lat * scale + camera.y
        };
    }

    unproject(screenX, screenY, viewport = null) {
        this.#ensureActive();

        const x = Number(screenX);
        const y = Number(screenY);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError("unproject requires finite screen coordinates.");
        }

        const size = this.#resolveViewport(viewport);
        const camera = this.mapManager.camera;
        const scale = Math.min(size.width / 360, size.height / 180) * camera.zoom;

        return {
            longitude: (x - size.width / 2 - camera.x) / scale,
            latitude: -(y - size.height / 2 - camera.y) / scale
        };
    }

    #resolveViewport(viewport) {
        if (viewport) {
            return validateSize(viewport.width, viewport.height);
        }

        const canvas = this.mapManager.canvas;
        if (!canvas || typeof canvas.getBoundingClientRect !== "function") {
            throw new Error("A viewport is required before the map canvas is initialized.");
        }

        const rect = canvas.getBoundingClientRect();
        return validateSize(
            rect.width || canvas.clientWidth,
            rect.height || canvas.clientHeight
        );
    }

    getSnapshot() {
        this.#ensureActive();
        return {
            ...this.mapManager.camera,
            viewport: this.mapManager.canvas
                ? (() => {
                    const rect = this.mapManager.canvas.getBoundingClientRect();
                    return { width: rect.width, height: rect.height };
                })()
                : null
        };
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("MapCamera has been destroyed.");
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.mapManager = null;
        this.destroyed = true;
    }
}

export default MapCamera;

console.log("WORLD AT WAR: Map Camera module loaded.");
