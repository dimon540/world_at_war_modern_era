/* =========================================================
   WORLD AT WAR: MODERN ERA
   MAP INTERACTION
   Version: 1.0.0

   Pointer, selection, drag and zoom interactions for the map.
========================================================= */

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

    const value = candidates.find(item =>
        item !== undefined && item !== null && String(item).trim() !== ""
    );

    return value === undefined ? `feature_${index + 1}` : String(value);
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

function pointInRing(point, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;

    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i]?.[0]);
        const yi = Number(ring[i]?.[1]);
        const xj = Number(ring[j]?.[0]);
        const yj = Number(ring[j]?.[1]);

        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

        const intersects = (
            (yi > point.lat) !== (yj > point.lat) &&
            point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi
        );

        if (intersects) inside = !inside;
    }

    return inside;
}

function pointInPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    if (!pointInRing(point, polygon[0])) return false;

    // GeoJSON polygon rings after the first represent holes.
    for (let index = 1; index < polygon.length; index += 1) {
        if (pointInRing(point, polygon[index])) return false;
    }

    return true;
}

function pointInGeometry(point, geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return false;

    if (geometry.type === "Polygon") {
        return pointInPolygon(point, geometry.coordinates);
    }

    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.some(polygon =>
            pointInPolygon(point, polygon)
        );
    }

    return false;
}

export class MapInteraction {
    constructor(options = {}) {
        this.options = {
            dragThreshold: 5,
            zoomStep: 1.15,
            minZoom: 0.5,
            maxZoom: 20,
            wheelZoom: true,
            dragToPan: true,
            selectOnClick: true,
            doubleClickZoom: true,
            preventContextMenu: true,
            ...options
        };

        this.canvas = null;
        this.mapManager = null;
        this.destroyed = false;
        this.pointer = null;
        this.dragging = false;
        this.suppressClick = false;
        this.listeners = [];
        this.lastPointerPosition = null;

        this.boundPointerDown = event => this.#onPointerDown(event);
        this.boundPointerMove = event => this.#onPointerMove(event);
        this.boundPointerUp = event => this.#onPointerUp(event);
        this.boundPointerCancel = event => this.#onPointerCancel(event);
        this.boundWheel = event => this.#onWheel(event);
        this.boundDoubleClick = event => this.#onDoubleClick(event);
        this.boundContextMenu = event => this.#onContextMenu(event);
        this.boundKeyDown = event => this.#onKeyDown(event);
    }

    initialize(canvas, mapManager) {
        this.#ensureActive();

        if (!canvas || typeof canvas.addEventListener !== "function") {
            throw new TypeError("MapInteraction requires a canvas element.");
        }
        if (!mapManager || typeof mapManager.setCamera !== "function") {
            throw new TypeError("MapInteraction requires a compatible MapManager.");
        }

        if (this.canvas) this.destroyListeners();

        this.canvas = canvas;
        this.mapManager = mapManager;

        canvas.style.touchAction = "none";
        canvas.style.cursor = "grab";

        this.#listen(canvas, "pointerdown", this.boundPointerDown);
        this.#listen(canvas, "pointermove", this.boundPointerMove);
        this.#listen(canvas, "pointerup", this.boundPointerUp);
        this.#listen(canvas, "pointercancel", this.boundPointerCancel);
        this.#listen(canvas, "lostpointercapture", this.boundPointerCancel);

        if (this.options.wheelZoom) {
            this.#listen(canvas, "wheel", this.boundWheel, { passive: false });
        }
        if (this.options.doubleClickZoom) {
            this.#listen(canvas, "dblclick", this.boundDoubleClick);
        }
        if (this.options.preventContextMenu) {
            this.#listen(canvas, "contextmenu", this.boundContextMenu);
        }

        const keyboardTarget = canvas.ownerDocument ?? globalThis.document;
        if (keyboardTarget) {
            this.#listen(keyboardTarget, "keydown", this.boundKeyDown);
        }

        return this;
    }

    #listen(target, eventName, callback, options) {
        target.addEventListener(eventName, callback, options);
        this.listeners.push({ target, eventName, callback, options });
    }

    destroyListeners() {
        for (const listener of this.listeners) {
            listener.target.removeEventListener(
                listener.eventName,
                listener.callback,
                listener.options
            );
        }

        this.listeners.length = 0;
        this.#releasePointer();
        this.pointer = null;
        this.dragging = false;
    }

    #getLocalPosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            width: rect.width,
            height: rect.height
        };
    }

    #getGeoPosition(localPosition) {
        const camera = this.mapManager.camera;
        const rect = this.canvas.getBoundingClientRect();
        const baseScale = Math.min(rect.width / 360, rect.height / 180);
        const scale = baseScale * camera.zoom;

        if (!Number.isFinite(scale) || scale <= 0) return null;

        return {
            lon: (localPosition.x - rect.width / 2 - camera.x) / scale,
            lat: -(localPosition.y - rect.height / 2 - camera.y) / scale
        };
    }

    #hitTest(localPosition) {
        const geoPosition = this.#getGeoPosition(localPosition);
        if (!geoPosition) return null;

        const features = this.mapManager.getFeatures();

        // Draw order is preserved: the last painted feature is hit first.
        for (let index = features.length - 1; index >= 0; index -= 1) {
            const feature = features[index];

            if (pointInGeometry(geoPosition, feature?.geometry)) {
                return {
                    feature,
                    featureId: getFeatureId(feature, index),
                    countryCode: getCountryCode(feature),
                    geoPosition
                };
            }
        }

        return null;
    }

    #onPointerDown(event) {
        if (this.destroyed || !this.canvas) return;
        if (event.button !== 0 && event.button !== 1) return;

        const position = this.#getLocalPosition(event);

        this.pointer = {
            id: event.pointerId,
            startX: position.x,
            startY: position.y,
            lastX: position.x,
            lastY: position.y,
            button: event.button,
            moved: false
        };

        this.dragging = false;
        this.suppressClick = false;

        try {
            this.canvas.setPointerCapture(event.pointerId);
        } catch (error) {
            // Pointer capture may be unavailable in embedded browsers.
        }

        if (this.options.dragToPan) {
            this.canvas.style.cursor = "grabbing";
        }
    }

    #onPointerMove(event) {
        if (this.destroyed || !this.canvas) return;

        const position = this.#getLocalPosition(event);
        this.lastPointerPosition = position;

        if (!this.pointer || this.pointer.id !== event.pointerId) return;

        const deltaX = position.x - this.pointer.lastX;
        const deltaY = position.y - this.pointer.lastY;
        const totalX = position.x - this.pointer.startX;
        const totalY = position.y - this.pointer.startY;

        if (
            !this.dragging &&
            Math.hypot(totalX, totalY) >= this.options.dragThreshold
        ) {
            this.dragging = true;
            this.pointer.moved = true;
        }

        if (this.dragging && this.options.dragToPan) {
            const camera = this.mapManager.camera;
            this.mapManager.setCamera({
                x: camera.x + deltaX,
                y: camera.y + deltaY
            });
        }

        this.pointer.lastX = position.x;
        this.pointer.lastY = position.y;
    }

    #onPointerUp(event) {
        if (!this.pointer || this.pointer.id !== event.pointerId) return;

        const pointer = this.pointer;
        const position = this.#getLocalPosition(event);

        if (!this.dragging && this.options.selectOnClick && pointer.button === 0) {
            this.#selectAt(position);
        }

        this.suppressClick = this.dragging;
        this.pointer = null;
        this.dragging = false;
        this.#releasePointer(event.pointerId);

        if (this.canvas) this.canvas.style.cursor = "grab";
    }

    #onPointerCancel(event) {
        if (this.pointer && event.pointerId !== undefined &&
            this.pointer.id !== event.pointerId) return;

        this.pointer = null;
        this.dragging = false;
        this.#releasePointer(event.pointerId);

        if (this.canvas) this.canvas.style.cursor = "grab";
    }

    #selectAt(position) {
        const hit = this.#hitTest(position);

        if (!hit) {
            this.mapManager.selectProvince(null);
            return null;
        }

        this.mapManager.selectProvince(hit.featureId);

        const countryId = this.#resolveCountryId(hit);
        if (countryId) {
            this.mapManager.selectCountry(countryId, { setPlayer: false });
        }

        return hit;
    }

    #resolveCountryId(hit) {
        const countries = this.mapManager.state.world.countries ?? {};
        const code = hit.countryCode;

        if (code) {
            for (const [id, country] of Object.entries(countries)) {
                if (
                    id === code ||
                    country?.id === code ||
                    country?.iso3 === code ||
                    country?.iso2 === code ||
                    country?.tag === code
                ) {
                    return id;
                }
            }
        }

        const owner = this.mapManager.state.world.ownership
            ?.provinceOwners?.[hit.featureId];

        return owner && countries[owner] ? owner : null;
    }

    #onWheel(event) {
        if (this.destroyed || !this.canvas) return;

        event.preventDefault();

        const position = this.#getLocalPosition(event);
        const factor = event.deltaY < 0
            ? this.options.zoomStep
            : 1 / this.options.zoomStep;

        this.mapManager.zoomBy(factor, {
            x: position.x,
            y: position.y
        });
    }

    #onDoubleClick(event) {
        if (this.destroyed || !this.canvas) return;

        event.preventDefault();

        const position = this.#getLocalPosition(event);
        this.mapManager.zoomBy(this.options.zoomStep, {
            x: position.x,
            y: position.y
        });
    }

    #onContextMenu(event) {
        event.preventDefault();
    }

    #onKeyDown(event) {
        if (this.destroyed || !this.canvas) return;

        const target = event.target;
        const tagName = target?.tagName?.toLowerCase();

        if (
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select" ||
            target?.isContentEditable
        ) {
            return;
        }

        const step = event.shiftKey ? 80 : 35;
        const camera = this.mapManager.camera;

        switch (event.key) {
            case "ArrowLeft":
                this.mapManager.setCamera({ x: camera.x + step });
                event.preventDefault();
                break;
            case "ArrowRight":
                this.mapManager.setCamera({ x: camera.x - step });
                event.preventDefault();
                break;
            case "ArrowUp":
                this.mapManager.setCamera({ y: camera.y + step });
                event.preventDefault();
                break;
            case "ArrowDown":
                this.mapManager.setCamera({ y: camera.y - step });
                event.preventDefault();
                break;
            case "+":
            case "=":
                this.mapManager.zoomBy(this.options.zoomStep);
                event.preventDefault();
                break;
            case "-":
                this.mapManager.zoomBy(1 / this.options.zoomStep);
                event.preventDefault();
                break;
            case "0":
                this.mapManager.setCamera({ x: 0, y: 0, zoom: 1 });
                event.preventDefault();
                break;
            default:
                break;
        }
    }

    #releasePointer(pointerId = this.pointer?.id) {
        if (
            pointerId === undefined ||
            !this.canvas ||
            typeof this.canvas.releasePointerCapture !== "function"
        ) {
            return;
        }

        try {
            if (
                typeof this.canvas.hasPointerCapture !== "function" ||
                this.canvas.hasPointerCapture(pointerId)
            ) {
                this.canvas.releasePointerCapture(pointerId);
            }
        } catch (error) {
            // Ignore browsers that have already released the pointer.
        }
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("MapInteraction has been destroyed.");
        }
    }

    getStatus() {
        return {
            initialized: Boolean(this.canvas && this.mapManager),
            dragging: this.dragging,
            pointerActive: Boolean(this.pointer),
            listenerCount: this.listeners.length
        };
    }

    destroy() {
        if (this.destroyed) return;

        this.destroyListeners();

        if (this.canvas) {
            this.canvas.style.cursor = "";
            this.canvas.style.touchAction = "";
        }

        this.canvas = null;
        this.mapManager = null;
        this.lastPointerPosition = null;
        this.destroyed = true;
    }
}

export default MapInteraction;

console.log("WORLD AT WAR: Map Interaction module loaded.");
