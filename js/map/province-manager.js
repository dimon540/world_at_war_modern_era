/* =========================================================
   WORLD AT WAR: MODERN ERA
   PROVINCE MANAGER
   Version: 1.0.0

   Province ownership, control, status and local development.
   Geographic source features remain immutable; gameplay state is
   stored separately in world.provinceStates and world.ownership.
========================================================= */

import {
    GAME_EVENTS,
    gameEventBus
} from "../core/event-bus.js";
import {
    PROVINCE_STATUS,
    markGameStateDirty
} from "../core/game-state.js";

const VALID_STATUSES = new Set(Object.values(PROVINCE_STATUS));

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value) {
    if (value === undefined || value === null) return null;
    const id = String(value).trim();
    return id.length ? id : null;
}

function createRegistry() {
    return Object.create(null);
}

function getFeatureName(feature, id) {
    const properties = feature?.properties ?? {};
    return String(
        properties.name ??
        properties.NAME ??
        properties.name_en ??
        properties.NAME_1 ??
        properties.admin ??
        properties.ADMIN ??
        id
    );
}

function getFeatureCountryCode(feature) {
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

function finiteNonNegative(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${fieldName} must be a finite non-negative number.`);
    }
    return number;
}

export class ProvinceManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.provinces || !state?.world?.countries || !state?.world?.ownership) {
            throw new TypeError("ProvinceManager requires an initialized world state.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            inferInitialOwners: true,
            emitEvents: true,
            ...options
        };
        this.destroyed = false;

        if (!isObject(this.state.world.ownership.provinceOwners)) {
            this.state.world.ownership.provinceOwners = createRegistry();
        }
        if (!isObject(this.state.world.ownership.provinceControllers)) {
            this.state.world.ownership.provinceControllers = createRegistry();
        }
        if (!isObject(this.state.world.provinceStates)) {
            this.state.world.provinceStates = createRegistry();
        }

        this.#initializeProvinceStates();
    }

    #initializeProvinceStates() {
        const provinces = this.state.world.provinces;
        const owners = this.state.world.ownership.provinceOwners;
        const controllers = this.state.world.ownership.provinceControllers;
        const provinceStates = this.state.world.provinceStates;

        for (const [provinceId, feature] of Object.entries(provinces)) {
            if (!isObject(feature)) continue;

            if (!provinceStates[provinceId]) {
                provinceStates[provinceId] = {
                    id: provinceId,
                    name: getFeatureName(feature, provinceId),
                    status: PROVINCE_STATUS.UNCONTROLLED,
                    population: 0,
                    development: 0,
                    infrastructure: 0,
                    terrain: null,
                    resources: {},
                    updatedAt: null
                };
            }

            if (this.options.inferInitialOwners &&
                !owners[provinceId] && !controllers[provinceId]) {
                const code = getFeatureCountryCode(feature);
                const countryId = this.#resolveCountryId(code);
                if (countryId) {
                    owners[provinceId] = countryId;
                    controllers[provinceId] = countryId;
                    provinceStates[provinceId].status = PROVINCE_STATUS.OWNED;
                }
            }
        }
    }

    #resolveCountryId(value) {
        const id = normalizeId(value);
        if (!id) return null;

        const countries = this.state.world.countries;
        if (countries[id]) return id;

        const normalized = id.toUpperCase();
        for (const [countryId, country] of Object.entries(countries)) {
            if (
                String(country?.id ?? "").toUpperCase() === normalized ||
                String(country?.iso3 ?? "").toUpperCase() === normalized ||
                String(country?.iso2 ?? "").toUpperCase() === normalized ||
                String(country?.tag ?? "").toUpperCase() === normalized
            ) {
                return countryId;
            }
        }

        return null;
    }

    #getProvinceOrThrow(provinceId) {
        const id = normalizeId(provinceId);
        if (!id || !this.state.world.provinces[id]) {
            throw new RangeError(`Unknown province: ${provinceId}`);
        }
        return id;
    }

    #emit(eventName, payload) {
        if (!this.options.emitEvents || !eventName ||
            typeof this.eventBus?.emit !== "function") return;

        this.eventBus.emit(eventName, {
            ...payload,
            timestamp: Date.now()
        });
    }

    #markDirty() {
        markGameStateDirty(this.state);
    }

    getProvince(provinceId) {
        this.#ensureActive();
        const id = normalizeId(provinceId);
        if (!id) return null;

        const feature = this.state.world.provinces[id];
        if (!feature) return null;

        return {
            id,
            name: this.state.world.provinceStates[id]?.name ??
                getFeatureName(feature, id),
            feature,
            properties: feature.properties ?? {},
            state: this.state.world.provinceStates[id] ?? null,
            ownerId: this.state.world.ownership.provinceOwners[id] ?? null,
            controllerId: this.state.world.ownership.provinceControllers[id] ?? null,
            status: this.state.world.provinceStates[id]?.status ??
                PROVINCE_STATUS.UNCONTROLLED
        };
    }

    getAllProvinces(options = {}) {
        this.#ensureActive();

        const { ownerId = null, controllerId = null, status = null } = options;
        return Object.keys(this.state.world.provinces)
            .filter(id => {
                if (ownerId !== null &&
                    this.state.world.ownership.provinceOwners[id] !== ownerId) return false;
                if (controllerId !== null &&
                    this.state.world.ownership.provinceControllers[id] !== controllerId) return false;
                if (status !== null &&
                    this.state.world.provinceStates[id]?.status !== status) return false;
                return true;
            })
            .map(id => this.getProvince(id));
    }

    getCountryProvinces(countryId, options = {}) {
        this.#ensureActive();
        const id = this.#resolveCountryId(countryId);
        if (!id) return [];

        const ownershipType = options.by === "controller"
            ? "provinceControllers"
            : "provinceOwners";

        return this.getAllProvinces({
            ...(ownershipType === "provinceOwners"
                ? { ownerId: id }
                : { controllerId: id })
        });
    }

    getProvinceOwner(provinceId) {
        this.#ensureActive();
        const id = normalizeId(provinceId);
        if (!id || !this.state.world.provinces[id]) return null;
        return this.state.world.ownership.provinceOwners[id] ?? null;
    }

    getProvinceController(provinceId) {
        this.#ensureActive();
        const id = normalizeId(provinceId);
        if (!id || !this.state.world.provinces[id]) return null;
        return this.state.world.ownership.provinceControllers[id] ?? null;
    }

    setOwner(provinceId, countryId, options = {}) {
        this.#ensureActive();

        const id = this.#getProvinceOrThrow(provinceId);
        const nextOwner = countryId === null ? null : this.#resolveCountryId(countryId);

        if (countryId !== null && !nextOwner) {
            throw new RangeError(`Unknown country: ${countryId}`);
        }

        const owners = this.state.world.ownership.provinceOwners;
        const previousOwner = owners[id] ?? null;
        if (previousOwner === nextOwner) return false;

        if (nextOwner === null) delete owners[id];
        else owners[id] = nextOwner;

        const provinceState = this.state.world.provinceStates[id];
        if (nextOwner === null) {
            provinceState.status = PROVINCE_STATUS.UNCONTROLLED;
            if (!options.keepController) {
                delete this.state.world.ownership.provinceControllers[id];
            }
        } else {
            provinceState.status = this.state.world.ownership.provinceControllers[id] === nextOwner
                ? PROVINCE_STATUS.OWNED
                : PROVINCE_STATUS.OCCUPIED;
        }

        provinceState.updatedAt = new Date().toISOString();
        this.#markDirty();

        this.#emit(GAME_EVENTS.PROVINCE_OWNER_CHANGED, {
            provinceId: id,
            previousOwnerId: previousOwner,
            ownerId: nextOwner
        });
        this.#emit(GAME_EVENTS.PROVINCE_UPDATED, {
            provinceId: id,
            reason: "owner_changed"
        });

        return true;
    }

    setController(provinceId, countryId, options = {}) {
        this.#ensureActive();

        const id = this.#getProvinceOrThrow(provinceId);
        const nextController = countryId === null ? null : this.#resolveCountryId(countryId);

        if (countryId !== null && !nextController) {
            throw new RangeError(`Unknown country: ${countryId}`);
        }

        const controllers = this.state.world.ownership.provinceControllers;
        const previousController = controllers[id] ?? null;
        if (previousController === nextController) return false;

        if (nextController === null) delete controllers[id];
        else controllers[id] = nextController;

        const owner = this.state.world.ownership.provinceOwners[id] ?? null;
        const provinceState = this.state.world.provinceStates[id];

        if (owner && nextController === owner) {
            provinceState.status = PROVINCE_STATUS.OWNED;
        } else if (owner && nextController) {
            provinceState.status = PROVINCE_STATUS.OCCUPIED;
        } else if (owner && !nextController) {
            provinceState.status = PROVINCE_STATUS.UNCONTROLLED;
        } else {
            provinceState.status = nextController
                ? PROVINCE_STATUS.OCCUPIED
                : PROVINCE_STATUS.UNCONTROLLED;
        }

        provinceState.updatedAt = new Date().toISOString();
        this.#markDirty();

        this.#emit(GAME_EVENTS.PROVINCE_CONTROLLER_CHANGED, {
            provinceId: id,
            previousControllerId: previousController,
            controllerId: nextController,
            ownerId: owner,
            ...options
        });
        this.#emit(GAME_EVENTS.PROVINCE_UPDATED, {
            provinceId: id,
            reason: "controller_changed"
        });

        return true;
    }

    transferProvince(provinceId, newOwnerId, options = {}) {
        this.#ensureActive();

        const id = this.#getProvinceOrThrow(provinceId);
        const ownerId = this.#resolveCountryId(newOwnerId);
        if (!ownerId) throw new RangeError(`Unknown country: ${newOwnerId}`);

        const previousOwnerId = this.getProvinceOwner(id);
        const previousControllerId = this.getProvinceController(id);

        this.state.world.ownership.provinceOwners[id] = ownerId;
        this.state.world.ownership.provinceControllers[id] =
            options.setController === false
                ? (previousControllerId ?? ownerId)
                : ownerId;

        const provinceState = this.state.world.provinceStates[id];
        provinceState.status = this.state.world.ownership.provinceControllers[id] === ownerId
            ? PROVINCE_STATUS.OWNED
            : PROVINCE_STATUS.OCCUPIED;
        provinceState.updatedAt = new Date().toISOString();

        this.#markDirty();

        if (previousOwnerId !== ownerId) {
            this.#emit(GAME_EVENTS.PROVINCE_OWNER_CHANGED, {
                provinceId: id,
                previousOwnerId,
                ownerId
            });
        }
        if (previousControllerId !== this.state.world.ownership.provinceControllers[id]) {
            this.#emit(GAME_EVENTS.PROVINCE_CONTROLLER_CHANGED, {
                provinceId: id,
                previousControllerId,
                controllerId: this.state.world.ownership.provinceControllers[id],
                ownerId
            });
        }

        this.#emit(GAME_EVENTS.PROVINCE_UPDATED, {
            provinceId: id,
            reason: "transferred"
        });

        return this.getProvince(id);
    }

    setStatus(provinceId, status) {
        this.#ensureActive();

        const id = this.#getProvinceOrThrow(provinceId);
        if (!VALID_STATUSES.has(status)) {
            throw new RangeError(`Invalid province status: ${status}`);
        }

        const provinceState = this.state.world.provinceStates[id];
        if (provinceState.status === status) return false;

        provinceState.status = status;
        provinceState.updatedAt = new Date().toISOString();
        this.#markDirty();

        this.#emit(GAME_EVENTS.PROVINCE_UPDATED, {
            provinceId: id,
            reason: "status_changed",
            status
        });

        return true;
    }

    updateProvinceData(provinceId, patch = {}) {
        this.#ensureActive();

        const id = this.#getProvinceOrThrow(provinceId);
        if (!isObject(patch)) {
            throw new TypeError("Province data patch must be an object.");
        }

        const allowed = ["population", "development", "infrastructure"];
        const provinceState = this.state.world.provinceStates[id];
        const next = {};

        for (const key of allowed) {
            if (patch[key] !== undefined) {
                next[key] = finiteNonNegative(patch[key], key);
            }
        }

        if (patch.terrain !== undefined) {
            if (patch.terrain !== null && typeof patch.terrain !== "string") {
                throw new TypeError("Province terrain must be a string or null.");
            }
            next.terrain = patch.terrain;
        }

        if (patch.resources !== undefined) {
            if (!isObject(patch.resources)) {
                throw new TypeError("Province resources must be an object.");
            }
            const resources = {};
            for (const [resource, amount] of Object.entries(patch.resources)) {
                resources[resource] = finiteNonNegative(amount, `resources.${resource}`);
            }
            next.resources = resources;
        }

        Object.assign(provinceState, next, {
            updatedAt: new Date().toISOString()
        });

        this.#markDirty();
        this.#emit(GAME_EVENTS.PROVINCE_UPDATED, {
            provinceId: id,
            reason: "data_changed",
            fields: Object.keys(next)
        });

        return this.getProvince(id);
    }

    getCountryProvinceCounts(countryId) {
        this.#ensureActive();
        const id = this.#resolveCountryId(countryId);
        if (!id) return { owned: 0, controlled: 0, occupied: 0 };

        let owned = 0;
        let controlled = 0;
        let occupied = 0;

        for (const provinceId of Object.keys(this.state.world.provinces)) {
            const owner = this.state.world.ownership.provinceOwners[provinceId] ?? null;
            const controller = this.state.world.ownership.provinceControllers[provinceId] ?? null;

            if (owner === id) owned += 1;
            if (controller === id) controlled += 1;
            if (owner === id && controller && controller !== id) occupied += 1;
        }

        return { owned, controlled, occupied };
    }

    getSnapshot() {
        this.#ensureActive();

        const total = Object.keys(this.state.world.provinces).length;
        const owners = this.state.world.ownership.provinceOwners;
        const controllers = this.state.world.ownership.provinceControllers;

        return {
            total,
            withOwner: Object.keys(owners).length,
            withController: Object.keys(controllers).length,
            withoutOwner: Math.max(0, total - Object.keys(owners).length)
        };
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("ProvinceManager has been destroyed.");
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.state = null;
        this.eventBus = null;
        this.destroyed = true;
    }
}

export default ProvinceManager;

console.log("WORLD AT WAR: Province Manager module loaded.");
