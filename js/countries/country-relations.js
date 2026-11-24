/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY RELATIONS
   Version: 1.0.0

   Directional diplomatic opinion between countries.
   Alliances, treaties, wars and sanctions are managed by
   dedicated diplomacy systems, not inferred here.
========================================================= */

import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const MIN_RELATION = -100;
const MAX_RELATION = 100;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireCountryId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}

function normalizeRelation(value) {
    if (!Number.isFinite(value)) throw new TypeError("Diplomatic relation must be a finite number.");
    return Math.max(MIN_RELATION, Math.min(MAX_RELATION, value));
}

function createRegistry() {
    return Object.create(null);
}

export class CountryRelations {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.countries || !state.diplomacy) {
            throw new TypeError("CountryRelations requires initialized world and diplomacy state.");
        }

        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            defaultRelation: 0,
            keepHistory: true,
            maxHistoryPerPair: 100,
            ...options
        };

        if (!Number.isFinite(this.options.defaultRelation)) {
            throw new TypeError("defaultRelation must be a finite number.");
        }
        if (!Number.isInteger(this.options.maxHistoryPerPair) || this.options.maxHistoryPerPair < 1) {
            throw new RangeError("maxHistoryPerPair must be a positive integer.");
        }

        if (!isRecord(this.state.diplomacy.relations)) {
            this.state.diplomacy.relations = createRegistry();
        }
        this.relations = this.state.diplomacy.relations;
        this.destroyed = false;
    }

    #ensureActive() {
        if (this.destroyed) throw new Error("CountryRelations has been destroyed.");
    }

    #resolvePair(fromCountryId, toCountryId) {
        const fromId = requireCountryId(fromCountryId, "Source country ID");
        const toId = requireCountryId(toCountryId, "Target country ID");
        if (fromId === toId) throw new RangeError("A country cannot have diplomatic relations with itself.");
        if (!this.state.world.countries[fromId]) throw new RangeError(`Unknown source country: ${fromId}`);
        if (!this.state.world.countries[toId]) throw new RangeError(`Unknown target country: ${toId}`);
        return { fromId, toId };
    }

    #getRecord(fromId, toId, create = false) {
        let outgoing = this.relations[fromId];
        if (!isRecord(outgoing)) {
            if (!create) return null;
            outgoing = this.relations[fromId] = createRegistry();
        }

        let record = outgoing[toId];
        if (!isRecord(record) && create) {
            record = outgoing[toId] = {
                fromCountryId: fromId,
                toCountryId: toId,
                value: normalizeRelation(this.options.defaultRelation),
                trust: null,
                updatedAt: null,
                history: []
            };
        }
        return isRecord(record) ? record : null;
    }

    getRelation(fromCountryId, toCountryId) {
        this.#ensureActive();
        const { fromId, toId } = this.#resolvePair(fromCountryId, toCountryId);
        const record = this.#getRecord(fromId, toId);
        return record ? { ...record, history: [...(record.history ?? [])] } : {
            fromCountryId: fromId,
            toCountryId: toId,
            value: normalizeRelation(this.options.defaultRelation),
            trust: null,
            updatedAt: null,
            history: []
        };
    }

    getValue(fromCountryId, toCountryId) {
        return this.getRelation(fromCountryId, toCountryId).value;
    }

    setRelation(fromCountryId, toCountryId, value, options = {}) {
        this.#ensureActive();
        const { fromId, toId } = this.#resolvePair(fromCountryId, toCountryId);
        const nextValue = normalizeRelation(value);
        const record = this.#getRecord(fromId, toId, true);
        const previousValue = record.value;
        const reason = String(options.reason ?? "diplomatic_change");

        if (options.trust !== undefined && options.trust !== null &&
            (!Number.isFinite(options.trust) || options.trust < 0 || options.trust > 100)) {
            throw new RangeError("Trust must be between 0 and 100.");
        }

        record.value = nextValue;
        if (options.trust !== undefined) {
            record.trust = options.trust === null ? null : options.trust;
        }
        record.updatedAt = new Date().toISOString();

        const historyEntry = {
            previousValue,
            value: nextValue,
            delta: nextValue - previousValue,
            reason,
            source: options.source ?? "system",
            date: options.date ?? null,
            timestamp: record.updatedAt
        };

        if (this.options.keepHistory) {
            if (!Array.isArray(record.history)) record.history = [];
            record.history.push(historyEntry);
            if (record.history.length > this.options.maxHistoryPerPair) {
                record.history.splice(0, record.history.length - this.options.maxHistoryPerPair);
            }
        }

        markGameStateDirty(this.state);
        const payload = {
            fromCountryId: fromId,
            toCountryId: toId,
            previousValue,
            value: nextValue,
            delta: nextValue - previousValue,
            reason,
            record
        };
        this.eventBus?.emit?.(GAME_EVENTS.RELATIONS_CHANGED, payload);
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, {
            reason: "diplomatic_relations_changed",
            fromCountryId: fromId,
            toCountryId: toId
        });

        return { ...record, history: [...(record.history ?? [])] };
    }

    modifyRelation(fromCountryId, toCountryId, delta, options = {}) {
        this.#ensureActive();
        if (!Number.isFinite(delta)) throw new TypeError("Relation change must be a finite number.");
        const current = this.getValue(fromCountryId, toCountryId);
        return this.setRelation(fromCountryId, toCountryId, current + delta, {
            ...options,
            reason: options.reason ?? "relation_modifier"
        });
    }

    improveRelations(fromCountryId, toCountryId, amount, options = {}) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new RangeError("Improvement amount must be a non-negative number.");
        }
        return this.modifyRelation(fromCountryId, toCountryId, amount, {
            ...options,
            reason: options.reason ?? "diplomatic_improvement"
        });
    }

    worsenRelations(fromCountryId, toCountryId, amount, options = {}) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new RangeError("Deterioration amount must be a non-negative number.");
        }
        return this.modifyRelation(fromCountryId, toCountryId, -amount, {
            ...options,
            reason: options.reason ?? "diplomatic_deterioration"
        });
    }

    getRelationsForCountry(countryId, options = {}) {
        this.#ensureActive();
        const id = requireCountryId(countryId, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        const outgoing = this.relations[id] ?? {};
        const result = Object.values(outgoing).filter(isRecord);
        return result
            .filter(record => options.minimum === undefined || record.value >= options.minimum)
            .filter(record => options.maximum === undefined || record.value <= options.maximum)
            .sort((a, b) => b.value - a.value)
            .map(record => ({ ...record, history: [...(record.history ?? [])] }));
    }

    getTopRelations(countryId, limit = 10) {
        this.#ensureActive();
        if (!Number.isInteger(limit) || limit < 0) throw new RangeError("Limit must be a non-negative integer.");
        return this.getRelationsForCountry(countryId).slice(0, limit);
    }

    getWorstRelations(countryId, limit = 10) {
        this.#ensureActive();
        if (!Number.isInteger(limit) || limit < 0) throw new RangeError("Limit must be a non-negative integer.");
        return this.getRelationsForCountry(countryId)
            .sort((a, b) => a.value - b.value)
            .slice(0, limit);
    }

    getMutualRelation(countryA, countryB) {
        this.#ensureActive();
        const forward = this.getRelation(countryA, countryB);
        const reverse = this.getRelation(countryB, countryA);
        return {
            countryA: forward.fromCountryId,
            countryB: forward.toCountryId,
            aToB: forward.value,
            bToA: reverse.value,
            average: (forward.value + reverse.value) / 2,
            difference: Math.abs(forward.value - reverse.value)
        };
    }

    removeRelation(fromCountryId, toCountryId) {
        this.#ensureActive();
        const { fromId, toId } = this.#resolvePair(fromCountryId, toCountryId);
        if (!this.relations[fromId]?.[toId]) return false;
        delete this.relations[fromId][toId];
        if (Object.keys(this.relations[fromId]).length === 0) delete this.relations[fromId];
        markGameStateDirty(this.state);
        this.eventBus?.emit?.(GAME_EVENTS.RELATIONS_CHANGED, {
            fromCountryId: fromId,
            toCountryId: toId,
            removed: true
        });
        return true;
    }

    getWorldStatistics() {
        this.#ensureActive();
        const records = Object.values(this.relations).flatMap(outgoing =>
            Object.values(outgoing ?? {}).filter(isRecord)
        );
        return {
            trackedDirectedRelations: records.length,
            averageRelation: records.length
                ? records.reduce((sum, record) => sum + normalizeRelation(record.value), 0) / records.length
                : null,
            friendlyRelations: records.filter(record => record.value >= 50).length,
            neutralRelations: records.filter(record => record.value > -25 && record.value < 50).length,
            hostileRelations: records.filter(record => record.value <= -25).length
        };
    }

    getSnapshot() {
        this.#ensureActive();
        return {
            countriesWithTrackedRelations: Object.keys(this.relations).length,
            ...this.getWorldStatistics()
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.state = null;
        this.eventBus = null;
        this.relations = null;
        this.destroyed = true;
    }
}

export default CountryRelations;

console.log("WORLD AT WAR: Country Relations module loaded.");
