/* =========================================================
   WORLD AT WAR: MODERN ERA
   DIVISION MANAGEMENT
   Creates and manages land formations from the shared unit
   type and equipment catalogues. Historical OOB data is
   intentionally kept separate from these mechanics.
========================================================= */

import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";
import { getUnitType } from "./unit-types.js";
import { equipmentCatalog } from "./equipment.js";

export const DIVISION_STATUS = Object.freeze({
    ACTIVE: "active",
    RESERVE: "reserve",
    TRAINING: "training",
    DISBANDED: "disbanded",
    DESTROYED: "destroyed"
});

const VALID_STATUSES = new Set(Object.values(DIVISION_STATUS));
let divisionSequence = 0;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}

function finiteNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`${label} must be between ${min} and ${max}.`);
    }
    return value;
}

function createDivisionId() {
    divisionSequence += 1;
    return `div_${Date.now().toString(36)}_${divisionSequence.toString(36)}`;
}

function cloneDivision(division) {
    return {
        ...division,
        composition: division.composition.map(item => ({ ...item, equipment: [...item.equipment] })),
        equipmentRequired: { ...division.equipmentRequired },
        equipmentAssigned: { ...division.equipmentAssigned },
        location: division.location ? { ...division.location } : null,
        history: division.history.map(entry => ({ ...entry, date: entry.date ? { ...entry.date } : null }))
    };
}

function normalizeComposition(composition) {
    const entries = Array.isArray(composition)
        ? composition
        : isRecord(composition)
            ? Object.entries(composition).map(([typeId, count]) => ({ typeId, count }))
            : null;

    if (!entries || entries.length === 0) {
        throw new TypeError("Division composition must contain at least one unit type.");
    }

    const normalized = [];
    for (const entry of entries) {
        if (!isRecord(entry)) throw new TypeError("Each composition entry must be an object.");
        const typeId = normalizeId(entry.typeId ?? entry.unitTypeId ?? entry.type, "Unit type ID");
        const count = entry.count ?? entry.battalions ?? 1;
        if (!Number.isSafeInteger(count) || count <= 0) {
            throw new RangeError(`Composition count for ${typeId} must be a positive integer.`);
        }
        const definition = getUnitType(typeId);
        if (!definition) throw new RangeError(`Unknown unit type: ${typeId}`);
        if (definition.category !== "land" && definition.domain !== "land") {
            throw new RangeError(`Unit type ${typeId} cannot be placed in a land division.`);
        }
        normalized.push({ typeId, count, definition });
    }
    return normalized;
}

function calculateFormation(composition) {
    const totals = {
        manpower: 0, speed: Infinity, attack: 0, defense: 0,
        breakthrough: 0, armor: 0, piercing: 0, airAttack: 0,
        supplyUse: 0, fuelUse: 0
    };
    const equipmentRequired = Object.create(null);
    const normalizedComposition = [];

    for (const item of composition) {
        const d = item.definition;
        totals.manpower += d.manpower * item.count;
        totals.speed = Math.min(totals.speed, d.speed);
        for (const field of ["attack", "defense", "breakthrough", "armor", "piercing", "airAttack", "supplyUse", "fuelUse"]) {
            totals[field] += d[field] * item.count;
        }
        for (const equipmentId of d.equipment) {
            if (!equipmentCatalog.has(equipmentId)) {
                throw new Error(`Unit type ${d.id} references unknown equipment ${equipmentId}.`);
            }
            equipmentRequired[equipmentId] = (equipmentRequired[equipmentId] ?? 0) + item.count;
        }
        normalizedComposition.push({
            typeId: item.typeId,
            name: d.name,
            count: item.count,
            manpower: d.manpower * item.count,
            equipment: [...d.equipment]
        });
    }

    return {
        totals: {
            ...totals,
            speed: Number.isFinite(totals.speed) ? totals.speed : 0
        },
        equipmentRequired
    };
}

export class DivisionManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries) {
            throw new TypeError("DivisionManager requires game state with military and world country registries.");
        }
        if (!isRecord(state.military.divisions)) state.military.divisions = Object.create(null);
        this.state = state;
        this.eventBus = eventBus;
        this.equipment = options.equipmentManager ?? null;
        this.destroyed = false;
    }

    #assertActive() {
        if (this.destroyed) throw new Error("DivisionManager has been destroyed.");
    }

    #country(countryId) {
        const id = normalizeId(countryId, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }

    #division(divisionId) {
        const id = normalizeId(divisionId, "Division ID");
        const division = this.state.military.divisions[id];
        if (!division) throw new RangeError(`Unknown division: ${id}`);
        return division;
    }

    #emit(eventName, payload) {
        if (eventName && this.eventBus?.emit) this.eventBus.emit(eventName, payload);
    }

    #touch(division, action, details = {}) {
        const date = this.state.clock?.date ? { ...this.state.clock.date } : null;
        division.updatedAt = Date.now();
        division.history.push({ action, date, details: { ...details } });
        if (division.history.length > 100) division.history.splice(0, division.history.length - 100);
    }

    createDivision(countryId, name, composition, options = {}) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        const divisionName = String(name ?? "").trim();
        if (!divisionName) throw new TypeError("Division name is required.");
        if (!isRecord(options)) throw new TypeError("Division options must be an object.");

        const normalized = normalizeComposition(composition);
        const { totals, equipmentRequired } = calculateFormation(normalized);
        const id = options.id ? normalizeId(options.id, "Division ID") : createDivisionId();
        if (this.state.military.divisions[id]) throw new Error(`Division ID already exists: ${id}`);

        const status = options.status ?? DIVISION_STATUS.ACTIVE;
        if (!VALID_STATUSES.has(status) || status === DIVISION_STATUS.DISBANDED || status === DIVISION_STATUS.DESTROYED) {
            throw new RangeError(`Invalid initial division status: ${status}`);
        }
        const strength = finiteNumber(options.strength ?? 1, "Division strength", { min: 0, max: 1 });
        const experience = finiteNumber(options.experience ?? 0, "Division experience", { min: 0, max: 1 });
        const equipmentAssigned = Object.create(null);

        if (options.requireEquipment === true) {
            if (!this.equipment) throw new Error("An EquipmentManager must be supplied to enforce equipment stock requirements.");
            const consumed = [];
            for (const [equipmentId, quantity] of Object.entries(equipmentRequired)) {
                const result = this.equipment.consumeStock(ownerId, equipmentId, quantity);
                if (!result.success) {
                    for (const item of consumed) this.equipment.addStock(ownerId, item.equipmentId, item.quantity);
                    return { success: false, reason: "insufficient_equipment", equipmentId, required: quantity, available: result.available };
                }
                consumed.push({ equipmentId, quantity });
                equipmentAssigned[equipmentId] = quantity;
            }
        }

        const now = Date.now();
        const division = {
            id,
            name: divisionName,
            countryId: ownerId,
            status,
            category: "land",
            composition: normalized.map(item => ({
                typeId: item.typeId,
                name: item.definition.name,
                count: item.count,
                manpower: item.definition.manpower * item.count,
                equipment: [...item.definition.equipment]
            })),
            manpower: Math.round(totals.manpower * strength),
            maxManpower: totals.manpower,
            strength,
            organization: finiteNumber(options.organization ?? 1, "Division organization", { min: 0, max: 1 }),
            experience,
            morale: finiteNumber(options.morale ?? 0.7, "Division morale", { min: 0, max: 1 }),
            stats: { ...totals },
            equipmentRequired: { ...equipmentRequired },
            equipmentAssigned,
            location: options.provinceId ? { provinceId: normalizeId(options.provinceId, "Province ID") } : null,
            commanderId: options.commanderId ? normalizeId(options.commanderId, "Commander ID") : null,
            createdAt: now,
            updatedAt: now,
            history: [{ action: "created", date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: {} }]
        };

        this.state.military.divisions[id] = division;
        this.state.military.statistics.totalDivisions = Object.keys(this.state.military.divisions)
            .filter(key => ![DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(this.state.military.divisions[key].status)).length;
        this.state.military.statistics.totalPersonnel = Object.values(this.state.military.divisions)
            .filter(item => ![DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(item.status))
            .reduce((sum, item) => sum + (item.manpower ?? 0), 0);
        this.#emit(GAME_EVENTS.DIVISION_CREATED, { division: cloneDivision(division), countryId: ownerId });
        return { success: true, division: cloneDivision(division) };
    }

    getDivision(divisionId) {
        this.#assertActive();
        return cloneDivision(this.#division(divisionId));
    }

    getDivisionsForCountry(countryId, { includeInactive = false } = {}) {
        this.#assertActive();
        const id = this.#country(countryId);
        return Object.values(this.state.military.divisions)
            .filter(division => division.countryId === id)
            .filter(division => includeInactive || ![DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cloneDivision);
    }

    setStatus(divisionId, status) {
        this.#assertActive();
        if (!VALID_STATUSES.has(status)) throw new RangeError(`Invalid division status: ${status}`);
        const division = this.#division(divisionId);
        if ([DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status)) {
            throw new Error("A disbanded or destroyed division cannot be reactivated.");
        }
        const previousStatus = division.status;
        division.status = status;
        this.#touch(division, "status_changed", { previousStatus, status });
        return cloneDivision(division);
    }

    setStrength(divisionId, strength) {
        this.#assertActive();
        const division = this.#division(divisionId);
        if ([DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status)) {
            throw new Error("Cannot change the strength of an inactive division.");
        }
        const next = finiteNumber(strength, "Division strength", { min: 0, max: 1 });
        division.strength = next;
        division.manpower = Math.round(division.maxManpower * next);
        this.#touch(division, "strength_changed", { strength: next });
        return cloneDivision(division);
    }

    setMorale(divisionId, morale) {
        this.#assertActive();
        const division = this.#division(divisionId);
        division.morale = finiteNumber(morale, "Division morale", { min: 0, max: 1 });
        this.#touch(division, "morale_changed", { morale: division.morale });
        return cloneDivision(division);
    }

    setOrganization(divisionId, organization) {
        this.#assertActive();
        const division = this.#division(divisionId);
        division.organization = finiteNumber(organization, "Division organization", { min: 0, max: 1 });
        this.#touch(division, "organization_changed", { organization: division.organization });
        return cloneDivision(division);
    }

    moveDivision(divisionId, provinceId) {
        this.#assertActive();
        const division = this.#division(divisionId);
        if ([DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status)) {
            throw new Error("An inactive division cannot move.");
        }
        const nextProvinceId = normalizeId(provinceId, "Province ID");
        if (!this.state.world.provinces?.[nextProvinceId]) {
            throw new RangeError(`Unknown province: ${nextProvinceId}`);
        }
        const previousProvinceId = division.location?.provinceId ?? null;
        division.location = { provinceId: nextProvinceId };
        this.#touch(division, "moved", { from: previousProvinceId, to: nextProvinceId });
        this.#emit(GAME_EVENTS.DIVISION_MOVED, {
            divisionId: division.id,
            countryId: division.countryId,
            fromProvinceId: previousProvinceId,
            toProvinceId: nextProvinceId
        });
        return cloneDivision(division);
    }

    assignCommander(divisionId, commanderId) {
        this.#assertActive();
        const division = this.#division(divisionId);
        const id = commanderId === null ? null : normalizeId(commanderId, "Commander ID");
        if (id && !this.state.military.commanders?.[id]) throw new RangeError(`Unknown commander: ${id}`);
        division.commanderId = id;
        this.#touch(division, "commander_assigned", { commanderId: id });
        return cloneDivision(division);
    }

    transferDivision(divisionId, newCountryId) {
        this.#assertActive();
        const division = this.#division(divisionId);
        const targetId = this.#country(newCountryId);
        if ([DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status)) {
            throw new Error("An inactive division cannot be transferred.");
        }
        const previousCountryId = division.countryId;
        if (previousCountryId === targetId) return cloneDivision(division);
        division.countryId = targetId;
        this.#touch(division, "transferred", { from: previousCountryId, to: targetId });
        this.#emit(GAME_EVENTS.WORLD_UPDATED, {
            type: "division_transferred",
            divisionId: division.id,
            fromCountryId: previousCountryId,
            toCountryId: targetId
        });
        return cloneDivision(division);
    }

    disbandDivision(divisionId, { returnEquipment = false } = {}) {
        this.#assertActive();
        const division = this.#division(divisionId);
        if ([DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(division.status)) {
            return { success: false, reason: "already_inactive" };
        }
        if (returnEquipment && this.equipment) {
            for (const [equipmentId, quantity] of Object.entries(division.equipmentAssigned)) {
                if (quantity > 0) this.equipment.addStock(division.countryId, equipmentId, quantity);
            }
        }
        division.status = DIVISION_STATUS.DISBANDED;
        division.manpower = 0;
        this.#touch(division, "disbanded", { returnEquipment });
        this.#recalculateStatistics();
        this.#emit(GAME_EVENTS.DIVISION_DESTROYED, { divisionId: division.id, countryId: division.countryId, reason: "disbanded" });
        return { success: true, division: cloneDivision(division) };
    }

    #recalculateStatistics() {
        const active = Object.values(this.state.military.divisions)
            .filter(item => ![DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(item.status));
        this.state.military.statistics.totalDivisions = active.length;
        this.state.military.statistics.totalPersonnel = active.reduce((sum, item) => sum + (item.manpower ?? 0), 0);
    }

    getCountryStatistics(countryId) {
        this.#assertActive();
        const id = this.#country(countryId);
        const divisions = Object.values(this.state.military.divisions)
            .filter(item => item.countryId === id && ![DIVISION_STATUS.DISBANDED, DIVISION_STATUS.DESTROYED].includes(item.status));
        return {
            countryId: id,
            divisions: divisions.length,
            personnel: divisions.reduce((sum, item) => sum + (item.manpower ?? 0), 0),
            averageStrength: divisions.length ? divisions.reduce((sum, item) => sum + item.strength, 0) / divisions.length : 0,
            averageMorale: divisions.length ? divisions.reduce((sum, item) => sum + item.morale, 0) / divisions.length : 0,
            byStatus: divisions.reduce((result, item) => {
                result[item.status] = (result[item.status] ?? 0) + 1;
                return result;
            }, {})
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
        this.equipment = null;
    }
}

export default DivisionManager;

console.log("WORLD AT WAR: Division Manager module loaded.");
