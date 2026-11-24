/* =========================================================
   WORLD AT WAR: MODERN ERA
   MAP MODES
   Version: 1.0.0

   Controls thematic map modes and independent visual overlays.
   Rendering is performed by MapRenderer through MapManager.
========================================================= */

const MODE_DEFINITIONS = Object.freeze({
    political: Object.freeze({
        id: "political",
        name: "Political",
        description: "Country ownership and political borders.",
        thematicLayer: null,
        dataRequirements: ["countries", "province ownership"]
    }),
    terrain: Object.freeze({
        id: "terrain",
        name: "Terrain",
        description: "Terrain and geographic classification.",
        thematicLayer: "terrain",
        dataRequirements: ["terrain properties"]
    }),
    resources: Object.freeze({
        id: "resources",
        name: "Resources",
        description: "Strategic and industrial resource distribution.",
        thematicLayer: "resources",
        dataRequirements: ["resource deposits"]
    }),
    infrastructure: Object.freeze({
        id: "infrastructure",
        name: "Infrastructure",
        description: "Roads, railways, ports and industrial infrastructure.",
        thematicLayer: "infrastructure",
        dataRequirements: ["infrastructure network"]
    }),
    supply: Object.freeze({
        id: "supply",
        name: "Supply",
        description: "Supply availability and logistical coverage.",
        thematicLayer: "supply",
        dataRequirements: ["supply network and supply levels"]
    }),
    military: Object.freeze({
        id: "military",
        name: "Military",
        description: "Military presence and force deployment.",
        thematicLayer: "military",
        dataRequirements: ["military deployment data"]
    }),
    diplomacy: Object.freeze({
        id: "diplomacy",
        name: "Diplomacy",
        description: "Countries differentiated for diplomatic analysis.",
        thematicLayer: null,
        dataRequirements: ["country relations"]
    })
});

const THEMATIC_LAYERS = Object.freeze([
    "terrain",
    "resources",
    "infrastructure",
    "supply",
    "military"
]);

const OVERLAY_LAYERS = Object.freeze([
    "political",
    "provinces",
    "rivers",
    "airZones",
    "navalRegions"
]);

function cloneDefinition(definition) {
    return {
        ...definition,
        dataRequirements: [...definition.dataRequirements]
    };
}

export class MapModes {
    constructor(mapManager, options = {}) {
        if (
            !mapManager ||
            typeof mapManager.setMode !== "function" ||
            typeof mapManager.setLayer !== "function"
        ) {
            throw new TypeError("MapModes requires a compatible MapManager.");
        }

        this.mapManager = mapManager;
        this.options = {
            defaultMode: "political",
            ...options
        };
        this.destroyed = false;

        // MapManager writes to state.map.layers when a layer changes.
        // Ensure that the persistent state registry always exists.
        if (!this.mapManager.state.map.layers ||
            typeof this.mapManager.state.map.layers !== "object") {
            this.mapManager.state.map.layers = {};
        }

        Object.assign(
            this.mapManager.state.map.layers,
            this.mapManager.layers ?? {}
        );

        if (!this.mapManager.layers) {
            this.mapManager.layers = { ...this.mapManager.state.map.layers };
        }

        const currentMode = this.mapManager.mode;
        if (!MODE_DEFINITIONS[currentMode]) {
            this.setMode(this.options.defaultMode);
        } else {
            this.#synchronizeThematicLayers(currentMode);
        }
    }

    get modes() {
        this.#ensureActive();
        return Object.keys(MODE_DEFINITIONS).map(id =>
            cloneDefinition(MODE_DEFINITIONS[id])
        );
    }

    get currentMode() {
        this.#ensureActive();
        return this.mapManager.mode;
    }

    getMode(modeId) {
        this.#ensureActive();
        const definition = MODE_DEFINITIONS[modeId];
        return definition ? cloneDefinition(definition) : null;
    }

    setMode(modeId) {
        this.#ensureActive();

        const definition = MODE_DEFINITIONS[modeId];
        if (!definition) {
            throw new RangeError(`Unknown map mode: ${modeId}`);
        }

        this.#synchronizeThematicLayers(modeId);
        this.mapManager.setMode(modeId);

        return this.getSnapshot();
    }

    nextMode() {
        this.#ensureActive();
        const modeIds = Object.keys(MODE_DEFINITIONS);
        const currentIndex = modeIds.indexOf(this.mapManager.mode);
        const nextIndex = (currentIndex + 1) % modeIds.length;
        return this.setMode(modeIds[nextIndex]);
    }

    previousMode() {
        this.#ensureActive();
        const modeIds = Object.keys(MODE_DEFINITIONS);
        const currentIndex = modeIds.indexOf(this.mapManager.mode);
        const previousIndex = (currentIndex - 1 + modeIds.length) % modeIds.length;
        return this.setMode(modeIds[previousIndex]);
    }

    #synchronizeThematicLayers(activeMode) {
        const layers = this.mapManager.layers ?? {};

        for (const layerName of THEMATIC_LAYERS) {
            const shouldBeEnabled = activeMode === layerName;

            if (Boolean(layers[layerName]) !== shouldBeEnabled) {
                this.mapManager.setLayer(layerName, shouldBeEnabled);
            }
        }
    }

    setOverlay(layerName, enabled) {
        this.#ensureActive();

        if (!OVERLAY_LAYERS.includes(layerName)) {
            throw new RangeError(`Unknown map overlay: ${layerName}`);
        }

        return this.mapManager.setLayer(layerName, Boolean(enabled));
    }

    toggleOverlay(layerName) {
        this.#ensureActive();

        if (!OVERLAY_LAYERS.includes(layerName)) {
            throw new RangeError(`Unknown map overlay: ${layerName}`);
        }

        return this.mapManager.toggleLayer(layerName);
    }

    isOverlayEnabled(layerName) {
        this.#ensureActive();

        if (!OVERLAY_LAYERS.includes(layerName)) {
            throw new RangeError(`Unknown map overlay: ${layerName}`);
        }

        return Boolean(this.mapManager.layers?.[layerName]);
    }

    getAvailableModes() {
        return this.modes;
    }

    getLayers() {
        this.#ensureActive();

        const layers = this.mapManager.layers ?? {};
        return {
            thematic: Object.fromEntries(
                THEMATIC_LAYERS.map(name => [name, Boolean(layers[name])])
            ),
            overlays: Object.fromEntries(
                OVERLAY_LAYERS.map(name => [name, Boolean(layers[name])])
            )
        };
    }

    getSnapshot() {
        this.#ensureActive();

        return {
            currentMode: this.mapManager.mode,
            mode: this.getMode(this.mapManager.mode),
            availableModes: this.modes,
            layers: this.getLayers()
        };
    }

    reset() {
        this.#ensureActive();

        for (const layerName of OVERLAY_LAYERS) {
            const defaultEnabled = layerName === "political" ||
                layerName === "provinces";

            if (Boolean(this.mapManager.layers?.[layerName]) !== defaultEnabled) {
                this.mapManager.setLayer(layerName, defaultEnabled);
            }
        }

        return this.setMode(this.options.defaultMode);
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("MapModes has been destroyed.");
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.mapManager = null;
        this.destroyed = true;
    }
}

export { MODE_DEFINITIONS, THEMATIC_LAYERS, OVERLAY_LAYERS };
export default MapModes;

console.log("WORLD AT WAR: Map Modes module loaded.");
