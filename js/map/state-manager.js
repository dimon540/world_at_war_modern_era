/* =========================================================
   WORLD AT WAR: MODERN ERA
   STATE MANAGER
   Version: 1.0.0

   Manages strategic states and political territories.
   A state groups map provinces; a territory is a separate
   political/geographical entity. No ownership is guessed.
========================================================= */

import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";
import { markGameStateDirty } from "../core/game-state.js";

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value, field = "ID") {
    if (value === undefined || value === null || String(value).trim() === "") {
        throw new TypeError(`${field} must be a non-empty value.`);
    }
    return String(value).trim();
}

function cleanName(value, field = "Name") {
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(`${field} must be a non-empty string.`);
    }
    return value.trim();
}

function registry() {
    return Object.create(null);
}

export class StateManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.states || !state?.world?.territories ||
            !state?.world?.provinces || !state?.world?.countries) {
            throw new TypeError("StateManager requires a valid initialized world state.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            emitEvents: true,
            validateProvinceMembership: true,
            ...options
        };
        this.destroyed = false;

        if (!isObject(this.state.world.states)) this.state.world.states = registry();
        if (!isObject(this.state.world.territories)) this.state.world.territories = registry();

        this.provinceToState = new Map();
        this.#rebuildProvinceIndex();
        this.#syncStatistics();
    }

    #ensureActive() {
        if (this.destroyed) throw new Error("StateManager has been destroyed.");
    }

    #markDirty() {
        markGameStateDirty(this.state);
        this.#syncStatistics();
    }

    #emit(eventName, payload) {
        if (!this.options.emitEvents || !eventName ||
            typeof this.eventBus?.emit !== "function") return;
        this.eventBus.emit(eventName, { ...payload, timestamp: Date.now() });
    }

    #rebuildProvinceIndex() {
        this.provinceToState.clear();
        for (const [stateId, record] of Object.entries(this.state.world.states)) {
            if (!isObject(record)) continue;
            if (!Array.isArray(record.provinceIds)) record.provinceIds = [];
            const unique = [...new Set(record.provinceIds.map(String))];
            record.provinceIds = unique.filter(id => Boolean(this.state.world.provinces[id]));
            for (const provinceId of record.provinceIds) {
                if (this.provinceToState.has(provinceId)) {
                    throw new Error(`Province "${provinceId}" belongs to more than one state.`);
                }
                this.provinceToState.set(provinceId, stateId);
            }
        }
    }

    #syncStatistics() {
        if (!this.state?.world?.statistics) return;
        this.state.world.statistics.totalStates = Object.keys(this.state.world.states).length;
        this.state.world.statistics.totalTerritories = Object.keys(this.state.world.territories).length;
    }

    #validateCountry(countryId) {
        if (countryId === null || countryId === undefined) return null;
        const id = normalizeId(countryId, "Country ID");
        if (!this.state.world.countries[id]) {
            throw new RangeError(`Unknown country: ${id}`);
        }
        return id;
    }

    #validateProvinces(provinceIds) {
        if (!Array.isArray(provinceIds)) {
            throw new TypeError("provinceIds must be an array.");
        }
        const ids = [...new Set(provinceIds.map(id => normalizeId(id, "Province ID")))];
        for (const id of ids) {
            if (!this.state.world.provinces[id]) {
                throw new RangeError(`Unknown province: ${id}`);
            }
        }
        return ids;
    }

    createState(data = {}) {
        this.#ensureActive();
        if (!isObject(data)) throw new TypeError("State data must be an object.");

        const id = normalizeId(data.id, "State ID");
        if (this.state.world.states[id]) throw new Error(`State already exists: ${id}`);

        const provinceIds = this.#validateProvinces(data.provinceIds ?? []);
        for (const provinceId of provinceIds) {
            if (this.options.validateProvinceMembership && this.provinceToState.has(provinceId)) {
                throw new Error(`Province "${provinceId}" is already assigned to state "${this.provinceToState.get(provinceId)}".`);
            }
        }

        const ownerId = this.#validateCountry(data.ownerId ?? null);
        const record = {
            id,
            name: cleanName(data.name, "State name"),
            type: data.type ?? "standard",
            ownerId,
            provinceIds,
            population: Number.isFinite(Number(data.population)) && Number(data.population) >= 0
                ? Number(data.population) : 0,
            resources: isObject(data.resources) ? { ...data.resources } : {},
            infrastructure: Number.isFinite(Number(data.infrastructure)) && Number(data.infrastructure) >= 0
                ? Number(data.infrastructure) : 0,
            metadata: isObject(data.metadata) ? { ...data.metadata } : {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.state.world.states[id] = record;
        for (const provinceId of provinceIds) this.provinceToState.set(provinceId, id);
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "state", action: "created", stateId: id });
        return this.getState(id);
    }

    updateState(stateId, patch = {}) {
        this.#ensureActive();
        const id = normalizeId(stateId, "State ID");
        const current = this.state.world.states[id];
        if (!current) throw new RangeError(`Unknown state: ${id}`);
        if (!isObject(patch)) throw new TypeError("State patch must be an object.");

        const next = {};
        if (patch.name !== undefined) next.name = cleanName(patch.name, "State name");
        if (patch.type !== undefined) next.type = cleanName(patch.type, "State type");
        if (patch.ownerId !== undefined) next.ownerId = this.#validateCountry(patch.ownerId);
        if (patch.population !== undefined) {
            const n = Number(patch.population);
            if (!Number.isFinite(n) || n < 0) throw new RangeError("Population must be non-negative.");
            next.population = n;
        }
        if (patch.infrastructure !== undefined) {
            const n = Number(patch.infrastructure);
            if (!Number.isFinite(n) || n < 0) throw new RangeError("Infrastructure must be non-negative.");
            next.infrastructure = n;
        }
        if (patch.resources !== undefined) {
            if (!isObject(patch.resources)) throw new TypeError("Resources must be an object.");
            next.resources = { ...patch.resources };
        }
        if (patch.metadata !== undefined) {
            if (!isObject(patch.metadata)) throw new TypeError("Metadata must be an object.");
            next.metadata = { ...current.metadata, ...patch.metadata };
        }

        Object.assign(current, next, { updatedAt: new Date().toISOString() });
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "state", action: "updated", stateId: id, fields: Object.keys(next) });
        return this.getState(id);
    }

    assignProvince(stateId, provinceId) {
        this.#ensureActive();
        const id = normalizeId(stateId, "State ID");
        if (!this.state.world.states[id]) throw new RangeError(`Unknown state: ${id}`);
        const province = normalizeId(provinceId, "Province ID");
        if (!this.state.world.provinces[province]) throw new RangeError(`Unknown province: ${province}`);

        const previousStateId = this.provinceToState.get(province) ?? null;
        if (previousStateId === id) return false;
        if (previousStateId) this.removeProvince(previousStateId, province);

        this.state.world.states[id].provinceIds.push(province);
        this.provinceToState.set(province, id);
        this.state.world.states[id].updatedAt = new Date().toISOString();
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            entity: "province_membership",
            provinceId: province,
            previousStateId,
            stateId: id
        });
        return true;
    }

    removeProvince(stateId, provinceId) {
        this.#ensureActive();
        const id = normalizeId(stateId, "State ID");
        const record = this.state.world.states[id];
        if (!record) throw new RangeError(`Unknown state: ${id}`);
        const province = normalizeId(provinceId, "Province ID");
        const index = record.provinceIds.indexOf(province);
        if (index === -1) return false;

        record.provinceIds.splice(index, 1);
        if (this.provinceToState.get(province) === id) this.provinceToState.delete(province);
        record.updatedAt = new Date().toISOString();
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            entity: "province_membership",
            provinceId: province,
            previousStateId: id,
            stateId: null
        });
        return true;
    }

    deleteState(stateId, options = {}) {
        this.#ensureActive();
        const id = normalizeId(stateId, "State ID");
        const record = this.state.world.states[id];
        if (!record) return false;
        if (record.provinceIds.length && options.reassignTo !== undefined) {
            const target = normalizeId(options.reassignTo, "Target state ID");
            if (!this.state.world.states[target] || target === id) {
                throw new RangeError("Target state does not exist or is identical to deleted state.");
            }
            for (const provinceId of [...record.provinceIds]) this.assignProvince(target, provinceId);
        } else {
            for (const provinceId of record.provinceIds) this.provinceToState.delete(provinceId);
        }

        delete this.state.world.states[id];
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "state", action: "deleted", stateId: id });
        return true;
    }

    getState(stateId) {
        this.#ensureActive();
        const id = String(stateId ?? "").trim();
        const record = this.state.world.states[id];
        if (!record) return null;
        return { ...record, provinceIds: [...record.provinceIds] };
    }

    getAllStates(options = {}) {
        this.#ensureActive();
        return Object.keys(this.state.world.states)
            .map(id => this.getState(id))
            .filter(record => options.ownerId === undefined || record.ownerId === options.ownerId);
    }

    getProvinceState(provinceId) {
        this.#ensureActive();
        const province = String(provinceId ?? "").trim();
        const stateId = this.provinceToState.get(province);
        return stateId ? this.getState(stateId) : null;
    }

    createTerritory(data = {}) {
        this.#ensureActive();
        if (!isObject(data)) throw new TypeError("Territory data must be an object.");
        const id = normalizeId(data.id, "Territory ID");
        if (this.state.world.territories[id]) throw new Error(`Territory already exists: ${id}`);

        const ownerId = this.#validateCountry(data.ownerId ?? null);
        const provinceIds = this.#validateProvinces(data.provinceIds ?? []);
        const record = {
            id,
            name: cleanName(data.name, "Territory name"),
            type: data.type ?? "dependent",
            ownerId,
            controllerId: this.#validateCountry(data.controllerId ?? ownerId),
            provinceIds,
            capital: data.capital ?? null,
            metadata: isObject(data.metadata) ? { ...data.metadata } : {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.state.world.territories[id] = record;
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "territory", action: "created", territoryId: id });
        return this.getTerritory(id);
    }

    updateTerritory(territoryId, patch = {}) {
        this.#ensureActive();
        const id = normalizeId(territoryId, "Territory ID");
        const current = this.state.world.territories[id];
        if (!current) throw new RangeError(`Unknown territory: ${id}`);
        if (!isObject(patch)) throw new TypeError("Territory patch must be an object.");

        const next = {};
        if (patch.name !== undefined) next.name = cleanName(patch.name, "Territory name");
        if (patch.type !== undefined) next.type = cleanName(patch.type, "Territory type");
        if (patch.ownerId !== undefined) next.ownerId = this.#validateCountry(patch.ownerId);
        if (patch.controllerId !== undefined) next.controllerId = this.#validateCountry(patch.controllerId);
        if (patch.capital !== undefined) next.capital = patch.capital;
        if (patch.provinceIds !== undefined) next.provinceIds = this.#validateProvinces(patch.provinceIds);
        if (patch.metadata !== undefined) {
            if (!isObject(patch.metadata)) throw new TypeError("Territory metadata must be an object.");
            next.metadata = { ...current.metadata, ...patch.metadata };
        }

        Object.assign(current, next, { updatedAt: new Date().toISOString() });
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "territory", action: "updated", territoryId: id, fields: Object.keys(next) });
        return this.getTerritory(id);
    }

    transferTerritory(territoryId, ownerId, controllerId = ownerId) {
        this.#ensureActive();
        const id = normalizeId(territoryId, "Territory ID");
        const record = this.state.world.territories[id];
        if (!record) throw new RangeError(`Unknown territory: ${id}`);

        record.ownerId = this.#validateCountry(ownerId);
        record.controllerId = this.#validateCountry(controllerId);
        record.updatedAt = new Date().toISOString();
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            entity: "territory",
            action: "transferred",
            territoryId: id,
            ownerId: record.ownerId,
            controllerId: record.controllerId
        });
        return this.getTerritory(id);
    }

    deleteTerritory(territoryId) {
        this.#ensureActive();
        const id = normalizeId(territoryId, "Territory ID");
        if (!this.state.world.territories[id]) return false;
        delete this.state.world.territories[id];
        this.#markDirty();
        this.#emit(GAME_EVENTS.WORLD_UPDATED, { entity: "territory", action: "deleted", territoryId: id });
        return true;
    }

    getTerritory(territoryId) {
        this.#ensureActive();
        const id = String(territoryId ?? "").trim();
        const record = this.state.world.territories[id];
        return record ? { ...record, provinceIds: [...(record.provinceIds ?? [])] } : null;
    }

    getAllTerritories(options = {}) {
        this.#ensureActive();
        return Object.keys(this.state.world.territories)
            .map(id => this.getTerritory(id))
            .filter(record => options.ownerId === undefined || record.ownerId === options.ownerId);
    }

    getSnapshot() {
        this.#ensureActive();
        return {
            states: Object.keys(this.state.world.states).length,
            territories: Object.keys(this.state.world.territories).length,
            provincesAssignedToStates: this.provinceToState.size,
            provincesUnassigned: Math.max(0,
                Object.keys(this.state.world.provinces).length - this.provinceToState.size)
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.provinceToState.clear();
        this.state = null;
        this.eventBus = null;
        this.destroyed = true;
    }
}

export default StateManager;

console.log("WORLD AT WAR: State Manager module loaded.");
