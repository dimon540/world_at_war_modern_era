/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY MANAGER
   Version: 1.0.0

   Central registry and lifecycle management for countries.
   Historical source fields are preserved; simulation status
   and runtime data are stored in separate fields.
========================================================= */

import {
    GAME_EVENTS,
    gameEventBus
} from "../core/event-bus.js";
import {
    COUNTRY_STATUS,
    selectPlayerCountry,
    markGameStateDirty
} from "../core/game-state.js";

const VALID_COUNTRY_STATUSES = new Set(Object.values(COUNTRY_STATUS));

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value) {
    if (value === undefined || value === null) return null;
    const id = String(value).trim();
    return id || null;
}

function normalizeCode(value) {
    const code = normalizeId(value);
    return code ? code.toUpperCase() : null;
}

function createRegistry() {
    return Object.create(null);
}

function cleanString(value, fieldName, { required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) throw new TypeError(`${fieldName} is required.`);
        return null;
    }
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string.`);
    }
    const result = value.trim();
    if (required && !result) throw new TypeError(`${fieldName} cannot be empty.`);
    return result || null;
}

function buildCountryRecord(source, id) {
    if (!isObject(source)) {
        throw new TypeError("Country record must be an object.");
    }

    const name = cleanString(source.name, "Country name", { required: true });
    const officialName = cleanString(source.officialName, "Official country name") ?? name;
    const iso2 = normalizeCode(source.iso2);
    const iso3 = normalizeCode(source.iso3);
    const tag = normalizeCode(source.tag);

    return {
        ...source,
        id,
        name,
        officialName,
        capital: cleanString(source.capital, "Capital"),
        iso2,
        iso3,
        tag,
        region: cleanString(source.region, "Region"),
        // Keep the dataset's historical political classification intact.
        status: source.status ?? "sovereign_state",
        gameStatus: source.gameStatus ?? COUNTRY_STATUS.ACTIVE,
        createdAt: source.createdAt ?? new Date().toISOString(),
        updatedAt: source.updatedAt ?? null
    };
}

export class CountryManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world || !isObject(state.world.countries)) {
            throw new TypeError("CountryManager requires a valid world country registry.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            emitEvents: true,
            validateOnUpdate: true,
            ...options
        };
        this.destroyed = false;
        this.codeIndex = new Map();
        this.nameIndex = new Map();

        this.#normalizeExistingCountries();
        this.#rebuildIndexes();
        this.#syncStatistics();
    }

    #normalizeExistingCountries() {
        const registry = this.state.world.countries;
        for (const [key, country] of Object.entries(registry)) {
            if (!isObject(country)) {
                throw new TypeError(`Invalid country record: ${key}`);
            }
            const id = normalizeId(country.id ?? key);
            if (!id || id !== key) {
                throw new Error(`Country registry key and country ID must match: ${key}`);
            }
            if (!country.name || typeof country.name !== "string") {
                throw new Error(`Country ${id} has no valid name.`);
            }
            country.gameStatus ??= COUNTRY_STATUS.ACTIVE;
            country.officialName ??= country.name;
            country.updatedAt ??= null;
        }
    }

    #rebuildIndexes() {
        this.codeIndex.clear();
        this.nameIndex.clear();

        for (const [id, country] of Object.entries(this.state.world.countries)) {
            for (const code of [country.iso3, country.iso2, country.tag, id]) {
                const normalized = normalizeCode(code);
                if (normalized && !this.codeIndex.has(normalized)) {
                    this.codeIndex.set(normalized, id);
                }
            }

            const normalizedName = String(country.name).trim().toLocaleLowerCase();
            if (normalizedName && !this.nameIndex.has(normalizedName)) {
                this.nameIndex.set(normalizedName, id);
            }
        }
    }

    #syncStatistics() {
        const countries = Object.values(this.state.world.countries);
        const total = countries.length;
        const active = countries.filter(country =>
            country.gameStatus === COUNTRY_STATUS.ACTIVE ||
            country.gameStatus === COUNTRY_STATUS.INDEPENDENT
        ).length;

        this.state.world.statistics.totalCountries = total;
        this.state.statistics.totalCountries = total;
        this.state.world.statistics.activeCountries = active;
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
        this.#syncStatistics();
    }

    #resolveId(value) {
        const id = normalizeId(value);
        if (!id) return null;
        if (this.state.world.countries[id]) return id;
        return this.codeIndex.get(normalizeCode(id)) ?? null;
    }

    #getOrThrow(countryId) {
        const id = this.#resolveId(countryId);
        if (!id) throw new RangeError(`Unknown country: ${countryId}`);
        return id;
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("CountryManager has been destroyed.");
        }
    }

    getCountry(countryId) {
        this.#ensureActive();
        const id = this.#resolveId(countryId);
        return id ? this.state.world.countries[id] : null;
    }

    getAllCountries(options = {}) {
        this.#ensureActive();
        const { region = null, gameStatus = null, includeEliminated = true } = options;

        return Object.values(this.state.world.countries).filter(country => {
            if (region && country.region !== region) return false;
            if (gameStatus && country.gameStatus !== gameStatus) return false;
            if (!includeEliminated && country.gameStatus === COUNTRY_STATUS.ELIMINATED) return false;
            return true;
        });
    }

    findCountry(query) {
        this.#ensureActive();
        const value = normalizeId(query);
        if (!value) return null;

        const direct = this.getCountry(value);
        if (direct) return direct;

        const id = this.nameIndex.get(value.toLocaleLowerCase());
        return id ? this.state.world.countries[id] : null;
    }

    getCountriesByRegion(region) {
        this.#ensureActive();
        const normalized = cleanString(region, "Region", { required: true });
        return this.getAllCountries({ region: normalized });
    }

    getCountryCount(options = {}) {
        this.#ensureActive();
        return this.getAllCountries(options).length;
    }

    createCountry(data) {
        this.#ensureActive();
        if (!isObject(data)) throw new TypeError("Country data must be an object.");

        const id = normalizeId(data.id ?? data.iso3 ?? data.tag);
        if (!id) throw new TypeError("Country requires a unique id.");
        if (this.state.world.countries[id]) {
            throw new Error(`Country already exists: ${id}`);
        }

        const country = buildCountryRecord(data, id);
        this.state.world.countries[id] = country;
        this.#rebuildIndexes();
        this.#markDirty();

        this.#emit(GAME_EVENTS.COUNTRY_CREATED, {
            countryId: id,
            country
        });

        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            reason: "country_created",
            countryId: id
        });

        return country;
    }

    updateCountry(countryId, patch = {}) {
        this.#ensureActive();
        const id = this.#getOrThrow(countryId);
        if (!isObject(patch)) throw new TypeError("Country patch must be an object.");

        const immutable = new Set(["id", "createdAt"]);
        for (const key of Object.keys(patch)) {
            if (immutable.has(key)) {
                throw new TypeError(`Country field "${key}" cannot be changed.`);
            }
        }

        const current = this.state.world.countries[id];
        const next = { ...current, ...patch, id };
        if (this.options.validateOnUpdate) {
            next.name = cleanString(next.name, "Country name", { required: true });
            next.officialName = cleanString(next.officialName, "Official country name") ?? next.name;
            for (const field of ["capital", "region"]) {
                next[field] = cleanString(next[field], field);
            }
            for (const field of ["iso2", "iso3", "tag"]) {
                next[field] = normalizeCode(next[field]);
            }
            if (!VALID_COUNTRY_STATUSES.has(next.gameStatus)) {
                throw new RangeError(`Invalid country game status: ${next.gameStatus}`);
            }
        }

        next.updatedAt = new Date().toISOString();
        this.state.world.countries[id] = next;
        this.#rebuildIndexes();
        this.#markDirty();

        this.#emit(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id,
            country: next,
            changedFields: Object.keys(patch)
        });

        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            reason: "country_updated",
            countryId: id
        });

        return next;
    }

    setCountryStatus(countryId, status, options = {}) {
        this.#ensureActive();
        const id = this.#getOrThrow(countryId);
        if (!VALID_COUNTRY_STATUSES.has(status)) {
            throw new RangeError(`Invalid country game status: ${status}`);
        }

        const country = this.state.world.countries[id];
        const previousStatus = country.gameStatus ?? COUNTRY_STATUS.ACTIVE;
        if (previousStatus === status) return false;

        country.gameStatus = status;
        country.updatedAt = new Date().toISOString();
        this.#markDirty();

        if (status === COUNTRY_STATUS.ELIMINATED) {
            this.#emit(GAME_EVENTS.COUNTRY_ELIMINATED, {
                countryId: id,
                previousStatus,
                status,
                ...options
            });
        } else if (previousStatus === COUNTRY_STATUS.ELIMINATED &&
            status !== COUNTRY_STATUS.ELIMINATED) {
            this.#emit(GAME_EVENTS.COUNTRY_INDEPENDENCE, {
                countryId: id,
                previousStatus,
                status,
                ...options
            });
        }

        this.#emit(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id,
            country,
            reason: "status_changed"
        });

        return true;
    }

    selectCountry(countryId) {
        this.#ensureActive();
        const id = this.#getOrThrow(countryId);
        const country = this.state.world.countries[id];

        if (country.gameStatus === COUNTRY_STATUS.ELIMINATED ||
            country.gameStatus === COUNTRY_STATUS.ANNEXED) {
            throw new Error(`Country cannot be selected: ${country.name}`);
        }

        if (!selectPlayerCountry(this.state, id)) return false;

        this.#emit(GAME_EVENTS.COUNTRY_SELECTED, {
            countryId: id,
            country,
            previousCountryId: this.state.player.previousCountryId ?? null
        });

        return true;
    }

    getCountryByCode(code) {
        this.#ensureActive();
        const id = this.codeIndex.get(normalizeCode(code));
        return id ? this.state.world.countries[id] : null;
    }

    getSnapshot() {
        this.#ensureActive();
        const countries = Object.values(this.state.world.countries);
        const byStatus = {};

        for (const status of VALID_COUNTRY_STATUSES) {
            byStatus[status] = countries.filter(country =>
                (country.gameStatus ?? COUNTRY_STATUS.ACTIVE) === status
            ).length;
        }

        return {
            total: countries.length,
            byStatus,
            regions: [...new Set(countries.map(country => country.region).filter(Boolean))].sort(),
            selectedCountryId: this.state.player.countryId ?? null
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.codeIndex.clear();
        this.nameIndex.clear();
        this.state = null;
        this.eventBus = null;
        this.destroyed = true;
    }
}

export default CountryManager;

console.log("WORLD AT WAR: Country Manager module loaded.");
