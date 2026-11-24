/* =========================================================
   WORLD AT WAR: MODERN ERA
   ARMY / FORMATION COMMAND
   Armies are organizational formations containing divisions.
   This module does not invent historical orders of battle.
========================================================= */

import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

export const ARMY_STATUS = Object.freeze({
    ACTIVE: "active",
    RESERVE: "reserve",
    TRAINING: "training",
    DISBANDED: "disbanded"
});

const VALID_STATUSES = new Set(Object.values(ARMY_STATUS));

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}

function cloneArmy(army) {
    return {
        ...army,
        divisionIds: [...army.divisionIds],
        history: army.history.map(entry => ({
            ...entry,
            date: entry.date ? { ...entry.date } : null,
            details: { ...entry.details }
        }))
    };
}

function createArmyId() {
    if (globalThis.crypto?.randomUUID) return `army_${globalThis.crypto.randomUUID()}`;
    return `army_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ArmyManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries) {
            throw new TypeError("ArmyManager requires game state with military and world country registries.");
        }
        if (!isRecord(state.military.armies)) state.military.armies = Object.create(null);
        if (!isRecord(state.military.divisions)) state.military.divisions = Object.create(null);
        if (!isRecord(state.military.statistics)) state.military.statistics = {};
        this.state = state;
        this.eventBus = eventBus;
        this.maxHistory = Number.isSafeInteger(options.maxHistory) && options.maxHistory > 0
            ? options.maxHistory : 100;
        this.destroyed = false;
    }

    #assertActive() {
        if (this.destroyed) throw new Error("ArmyManager has been destroyed.");
    }

    #country(countryId) {
        const id = requiredId(countryId, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }

    #army(armyId) {
        const id = requiredId(armyId, "Army ID");
        const army = this.state.military.armies[id];
        if (!army) throw new RangeError(`Unknown army: ${id}`);
        return army;
    }

    #division(divisionId) {
        const id = requiredId(divisionId, "Division ID");
        const division = this.state.military.divisions[id];
        if (!division) throw new RangeError(`Unknown division: ${id}`);
        return division;
    }

    #record(army, action, details = {}) {
        army.updatedAt = Date.now();
        army.history.push({
            action,
            date: this.state.clock?.date ? { ...this.state.clock.date } : null,
            details: { ...details }
        });
        if (army.history.length > this.maxHistory) {
            army.history.splice(0, army.history.length - this.maxHistory);
        }
    }

    #emit(type, payload) {
        if (this.eventBus?.emit) {
            this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, { type, ...payload });
        }
    }

    #refreshStatistics() {
        const active = Object.values(this.state.military.armies)
            .filter(army => army.status !== ARMY_STATUS.DISBANDED);
        this.state.military.statistics.totalArmies = active.length;
        this.state.military.statistics.totalArmyDivisions = active.reduce(
            (sum, army) => sum + army.divisionIds.length, 0
        );
        const activeDivisions = Object.values(this.state.military.divisions)
            .filter(division => !["disbanded", "destroyed"].includes(division.status));
        this.state.military.statistics.totalDivisions = activeDivisions.length;
        this.state.military.statistics.totalPersonnel = activeDivisions.reduce(
            (sum, division) => sum + (division.manpower ?? 0), 0
        );
    }

    createArmy(countryId, name, options = {}) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        const armyName = String(name ?? "").trim();
        if (!armyName) throw new TypeError("Army name is required.");
        if (!isRecord(options)) throw new TypeError("Army options must be an object.");

        const id = options.id ? requiredId(options.id, "Army ID") : createArmyId();
        if (this.state.military.armies[id]) throw new Error(`Army ID already exists: ${id}`);
        const status = options.status ?? ARMY_STATUS.ACTIVE;
        if (!VALID_STATUSES.has(status) || status === ARMY_STATUS.DISBANDED) {
            throw new RangeError(`Invalid initial army status: ${status}`);
        }
        const commanderId = options.commanderId == null ? null : requiredId(options.commanderId, "Commander ID");
        if (commanderId && !this.state.military.commanders?.[commanderId]) {
            throw new RangeError(`Unknown commander: ${commanderId}`);
        }

        const now = Date.now();
        const army = {
            id,
            name: armyName,
            countryId: ownerId,
            status,
            divisionIds: [],
            commanderId,
            headquartersProvinceId: options.headquartersProvinceId
                ? requiredId(options.headquartersProvinceId, "Headquarters province ID") : null,
            createdAt: now,
            updatedAt: now,
            history: [{
                action: "created",
                date: this.state.clock?.date ? { ...this.state.clock.date } : null,
                details: {}
            }]
        };
        if (army.headquartersProvinceId && !this.state.world.provinces?.[army.headquartersProvinceId]) {
            throw new RangeError(`Unknown headquarters province: ${army.headquartersProvinceId}`);
        }

        this.state.military.armies[id] = army;
        this.#refreshStatistics();
        if (this.eventBus?.emit) {
            this.eventBus.emit(GAME_EVENTS.ARMY_CREATED, {
                army: cloneArmy(army),
                countryId: ownerId
            });
        }
        return { success: true, army: cloneArmy(army) };
    }

    getArmy(armyId) {
        this.#assertActive();
        return cloneArmy(this.#army(armyId));
    }

    getArmiesForCountry(countryId, { includeDisbanded = false } = {}) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        return Object.values(this.state.military.armies)
            .filter(army => army.countryId === ownerId)
            .filter(army => includeDisbanded || army.status !== ARMY_STATUS.DISBANDED)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cloneArmy);
    }

    assignDivision(armyId, divisionId) {
        this.#assertActive();
        const army = this.#army(armyId);
        const division = this.#division(divisionId);
        if (army.status === ARMY_STATUS.DISBANDED) throw new Error("Cannot assign divisions to a disbanded army.");
        if ([ "disbanded", "destroyed" ].includes(division.status)) {
            throw new Error("Cannot assign an inactive division.");
        }
        if (division.countryId !== army.countryId) {
            throw new Error("Army and division must belong to the same country.");
        }
        if (army.divisionIds.includes(division.id)) return { success: true, changed: false, army: cloneArmy(army) };

        const previousArmyId = division.armyId ?? null;
        if (previousArmyId && this.state.military.armies[previousArmyId]) {
            const previousArmy = this.state.military.armies[previousArmyId];
            previousArmy.divisionIds = previousArmy.divisionIds.filter(id => id !== division.id);
            this.#record(previousArmy, "division_reassigned", { divisionId: division.id, toArmyId: army.id });
        }
        army.divisionIds.push(division.id);
        division.armyId = army.id;
        this.#record(army, "division_assigned", { divisionId: division.id, fromArmyId: previousArmyId });
        this.#refreshStatistics();
        this.#emit("division_assigned_to_army", { armyId: army.id, divisionId: division.id, countryId: army.countryId });
        return { success: true, changed: true, army: cloneArmy(army) };
    }

    removeDivision(armyId, divisionId) {
        this.#assertActive();
        const army = this.#army(armyId);
        const division = this.#division(divisionId);
        if (!army.divisionIds.includes(division.id)) {
            return { success: false, reason: "division_not_assigned", army: cloneArmy(army) };
        }
        army.divisionIds = army.divisionIds.filter(id => id !== division.id);
        if (division.armyId === army.id) division.armyId = null;
        this.#record(army, "division_removed", { divisionId: division.id });
        this.#refreshStatistics();
        this.#emit("division_removed_from_army", { armyId: army.id, divisionId: division.id, countryId: army.countryId });
        return { success: true, army: cloneArmy(army) };
    }

    setStatus(armyId, status) {
        this.#assertActive();
        if (!VALID_STATUSES.has(status)) throw new RangeError(`Invalid army status: ${status}`);
        if (status === ARMY_STATUS.DISBANDED) {
            throw new Error("Use disbandArmy() to disband an army and safely detach its divisions.");
        }
        const army = this.#army(armyId);
        const previousStatus = army.status;
        army.status = status;
        this.#record(army, "status_changed", { previousStatus, status });
        this.#refreshStatistics();
        this.#emit("army_status_changed", { armyId: army.id, countryId: army.countryId, previousStatus, status });
        return cloneArmy(army);
    }

    renameArmy(armyId, name) {
        this.#assertActive();
        const army = this.#army(armyId);
        const nextName = String(name ?? "").trim();
        if (!nextName) throw new TypeError("Army name is required.");
        const previousName = army.name;
        army.name = nextName;
        this.#record(army, "renamed", { previousName, name: nextName });
        this.#emit("army_renamed", { armyId: army.id, countryId: army.countryId, previousName, name: nextName });
        return cloneArmy(army);
    }

    assignCommander(armyId, commanderId) {
        this.#assertActive();
        const army = this.#army(armyId);
        const id = commanderId === null ? null : requiredId(commanderId, "Commander ID");
        if (id && !this.state.military.commanders?.[id]) throw new RangeError(`Unknown commander: ${id}`);
        const previousCommanderId = army.commanderId;
        army.commanderId = id;
        this.#record(army, "commander_assigned", { previousCommanderId, commanderId: id });
        this.#emit("army_commander_changed", { armyId: army.id, countryId: army.countryId, commanderId: id });
        return cloneArmy(army);
    }

    setHeadquarters(armyId, provinceId) {
        this.#assertActive();
        const army = this.#army(armyId);
        const id = provinceId === null ? null : requiredId(provinceId, "Province ID");
        if (id && !this.state.world.provinces?.[id]) throw new RangeError(`Unknown province: ${id}`);
        const previousProvinceId = army.headquartersProvinceId;
        army.headquartersProvinceId = id;
        this.#record(army, "headquarters_changed", { previousProvinceId, provinceId: id });
        this.#emit("army_headquarters_changed", { armyId: army.id, countryId: army.countryId, provinceId: id });
        return cloneArmy(army);
    }

    getArmyStrength(armyId) {
        this.#assertActive();
        const army = this.#army(armyId);
        const divisions = army.divisionIds
            .map(id => this.state.military.divisions[id])
            .filter(division => division && !["disbanded", "destroyed"].includes(division.status));
        return {
            armyId: army.id,
            divisionCount: divisions.length,
            personnel: divisions.reduce((sum, division) => sum + (division.manpower ?? 0), 0),
            averageStrength: divisions.length
                ? divisions.reduce((sum, division) => sum + (division.strength ?? 0), 0) / divisions.length : 0,
            averageOrganization: divisions.length
                ? divisions.reduce((sum, division) => sum + (division.organization ?? 0), 0) / divisions.length : 0,
            averageMorale: divisions.length
                ? divisions.reduce((sum, division) => sum + (division.morale ?? 0), 0) / divisions.length : 0
        };
    }

    disbandArmy(armyId, { keepDivisions = true } = {}) {
        this.#assertActive();
        const army = this.#army(armyId);
        if (army.status === ARMY_STATUS.DISBANDED) {
            return { success: false, reason: "already_disbanded" };
        }
        if (keepDivisions) {
            for (const divisionId of army.divisionIds) {
                const division = this.state.military.divisions[divisionId];
                if (division?.armyId === army.id) division.armyId = null;
            }
        } else {
            for (const divisionId of army.divisionIds) {
                const division = this.state.military.divisions[divisionId];
                if (division && !["disbanded", "destroyed"].includes(division.status)) {
                    division.status = "disbanded";
                    division.manpower = 0;
                    division.armyId = null;
                    if (division.commanderId) {
                        const commander = this.state.military.commanders?.[division.commanderId];
                        if (commander?.assignment?.type === "division"
                            && commander.assignment.id === division.id) {
                            commander.assignment = null;
                        }
                        division.commanderId = null;
                    }
                }
            }
        }
        const divisionIds = [...army.divisionIds];
        army.divisionIds = [];
        army.status = ARMY_STATUS.DISBANDED;
        this.#record(army, "disbanded", { keepDivisions, divisionIds });
        this.#refreshStatistics();
        this.#emit("army_disbanded", { armyId: army.id, countryId: army.countryId, divisionIds });
        return { success: true, army: cloneArmy(army) };
    }

    getCountryStatistics(countryId) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        const armies = Object.values(this.state.military.armies)
            .filter(army => army.countryId === ownerId && army.status !== ARMY_STATUS.DISBANDED);
        const divisionIds = new Set(armies.flatMap(army => army.divisionIds));
        const divisions = [...divisionIds]
            .map(id => this.state.military.divisions[id])
            .filter(division => division && !["disbanded", "destroyed"].includes(division.status));
        return {
            countryId: ownerId,
            armies: armies.length,
            assignedDivisions: divisions.length,
            personnel: divisions.reduce((sum, division) => sum + (division.manpower ?? 0), 0),
            unassignedDivisions: Object.values(this.state.military.divisions)
                .filter(division => division.countryId === ownerId
                    && !["disbanded", "destroyed"].includes(division.status)
                    && !division.armyId).length
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}

export default ArmyManager;

console.log("WORLD AT WAR: Army Manager module loaded.");
