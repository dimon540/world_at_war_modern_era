/* =========================================================
   WORLD AT WAR: MODERN ERA
   COMMANDER PERSONNEL SYSTEM
   Personnel mechanics are separate from historical leader data.
========================================================= */

import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

export const COMMANDER_STATUS = Object.freeze({
    ACTIVE: "active",
    RESERVE: "reserve",
    RETIRED: "retired",
    CAPTURED: "captured",
    KILLED: "killed"
});

export const COMMANDER_RANKS = Object.freeze([
    "recruit",
    "junior_officer",
    "officer",
    "senior_officer",
    "general",
    "senior_general",
    "field_marshal"
]);

const VALID_STATUSES = new Set(Object.values(COMMANDER_STATUS));
const VALID_RANKS = new Set(COMMANDER_RANKS);

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}

function boundedNumber(value, label, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`${label} must be between ${min} and ${max}.`);
    }
    return value;
}

function cloneCommander(commander) {
    return {
        ...commander,
        skills: { ...commander.skills },
        traits: [...commander.traits],
        history: commander.history.map(entry => ({
            ...entry,
            date: entry.date ? { ...entry.date } : null,
            details: { ...entry.details }
        })),
        assignment: commander.assignment ? { ...commander.assignment } : null
    };
}

function createCommanderId() {
    if (globalThis.crypto?.randomUUID) return `cmd_${globalThis.crypto.randomUUID()}`;
    return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class CommanderManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries) {
            throw new TypeError("CommanderManager requires military state and a country registry.");
        }
        if (!isRecord(state.military.commanders)) state.military.commanders = Object.create(null);
        if (!isRecord(state.military.statistics)) state.military.statistics = {};
        this.state = state;
        this.eventBus = eventBus;
        this.maxHistory = Number.isSafeInteger(options.maxHistory) && options.maxHistory > 0
            ? options.maxHistory : 100;
        this.destroyed = false;
    }

    #assertActive() {
        if (this.destroyed) throw new Error("CommanderManager has been destroyed.");
    }

    #country(countryId) {
        const id = requiredId(countryId, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }

    #commander(commanderId) {
        const id = requiredId(commanderId, "Commander ID");
        const commander = this.state.military.commanders[id];
        if (!commander) throw new RangeError(`Unknown commander: ${id}`);
        return commander;
    }

    #record(commander, action, details = {}) {
        commander.updatedAt = Date.now();
        commander.history.push({
            action,
            date: this.state.clock?.date ? { ...this.state.clock.date } : null,
            details: { ...details }
        });
        if (commander.history.length > this.maxHistory) {
            commander.history.splice(0, commander.history.length - this.maxHistory);
        }
    }

    #emit(type, commander, details = {}) {
        if (this.eventBus?.emit) {
            this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, {
                type,
                commanderId: commander.id,
                countryId: commander.countryId,
                ...details
            });
        }
    }

    #refreshStatistics() {
        const active = Object.values(this.state.military.commanders)
            .filter(item => item.status === COMMANDER_STATUS.ACTIVE);
        this.state.military.statistics.totalCommanders = active.length;
        this.state.military.statistics.assignedCommanders = active.filter(item => item.assignment).length;
    }

    createCommander(countryId, name, options = {}) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        const commanderName = String(name ?? "").trim();
        if (!commanderName) throw new TypeError("Commander name is required.");
        if (!isRecord(options)) throw new TypeError("Commander options must be an object.");

        const id = options.id ? requiredId(options.id, "Commander ID") : createCommanderId();
        if (this.state.military.commanders[id]) throw new Error(`Commander ID already exists: ${id}`);
        const rank = options.rank ?? "officer";
        const status = options.status ?? COMMANDER_STATUS.ACTIVE;
        if (!VALID_RANKS.has(rank)) throw new RangeError(`Invalid commander rank: ${rank}`);
        if (!VALID_STATUSES.has(status)) throw new RangeError(`Invalid commander status: ${status}`);

        const skills = isRecord(options.skills) ? options.skills : {};
        const normalizedSkills = {
            attack: boundedNumber(skills.attack ?? 0.5, "Attack skill", 0, 1),
            defense: boundedNumber(skills.defense ?? 0.5, "Defense skill", 0, 1),
            logistics: boundedNumber(skills.logistics ?? 0.5, "Logistics skill", 0, 1),
            planning: boundedNumber(skills.planning ?? 0.5, "Planning skill", 0, 1)
        };
        const traits = options.traits ?? [];
        if (!Array.isArray(traits) || traits.some(item => typeof item !== "string" || !item.trim())) {
            throw new TypeError("Commander traits must be an array of non-empty strings.");
        }
        const now = Date.now();
        const commander = {
            id,
            name: commanderName,
            countryId: ownerId,
            rank,
            status,
            experience: boundedNumber(options.experience ?? 0, "Commander experience", 0, 100),
            skills: normalizedSkills,
            traits: [...new Set(traits.map(item => item.trim()))],
            assignment: null,
            portrait: typeof options.portrait === "string" ? options.portrait : null,
            birthDate: options.birthDate ?? null,
            createdAt: now,
            updatedAt: now,
            history: [{
                action: "created",
                date: this.state.clock?.date ? { ...this.state.clock.date } : null,
                details: {}
            }]
        };
        this.state.military.commanders[id] = commander;
        this.#refreshStatistics();
        this.#emit("commander_created", commander);
        return { success: true, commander: cloneCommander(commander) };
    }

    getCommander(commanderId) {
        this.#assertActive();
        return cloneCommander(this.#commander(commanderId));
    }

    getCommandersForCountry(countryId, { includeInactive = false } = {}) {
        this.#assertActive();
        const ownerId = this.#country(countryId);
        return Object.values(this.state.military.commanders)
            .filter(item => item.countryId === ownerId)
            .filter(item => includeInactive || item.status === COMMANDER_STATUS.ACTIVE)
            .sort((a, b) => COMMANDER_RANKS.indexOf(b.rank) - COMMANDER_RANKS.indexOf(a.rank)
                || a.name.localeCompare(b.name))
            .map(cloneCommander);
    }

    updateCommander(commanderId, updates = {}) {
        this.#assertActive();
        if (!isRecord(updates)) throw new TypeError("Commander updates must be an object.");
        const commander = this.#commander(commanderId);
        const allowed = ["name", "rank", "experience", "skills", "traits", "portrait", "birthDate"];
        const changed = {};
        for (const key of Object.keys(updates)) {
            if (!allowed.includes(key)) throw new TypeError(`Commander field cannot be updated: ${key}`);
        }
        if (updates.name !== undefined) {
            const name = String(updates.name).trim();
            if (!name) throw new TypeError("Commander name is required.");
            changed.name = [commander.name, name];
            commander.name = name;
        }
        if (updates.rank !== undefined) {
            if (!VALID_RANKS.has(updates.rank)) throw new RangeError(`Invalid commander rank: ${updates.rank}`);
            changed.rank = [commander.rank, updates.rank];
            commander.rank = updates.rank;
        }
        if (updates.experience !== undefined) {
            const experience = boundedNumber(updates.experience, "Commander experience", 0, 100);
            changed.experience = [commander.experience, experience];
            commander.experience = experience;
        }
        if (updates.skills !== undefined) {
            if (!isRecord(updates.skills)) throw new TypeError("Commander skills must be an object.");
            const next = { ...commander.skills };
            for (const [key, value] of Object.entries(updates.skills)) {
                if (!(key in next)) throw new TypeError(`Unknown commander skill: ${key}`);
                next[key] = boundedNumber(value, `${key} skill`, 0, 1);
            }
            changed.skills = true;
            commander.skills = next;
        }
        if (updates.traits !== undefined) {
            if (!Array.isArray(updates.traits) || updates.traits.some(item => typeof item !== "string" || !item.trim())) {
                throw new TypeError("Commander traits must be an array of non-empty strings.");
            }
            changed.traits = true;
            commander.traits = [...new Set(updates.traits.map(item => item.trim()))];
        }
        if (updates.portrait !== undefined) commander.portrait = updates.portrait;
        if (updates.birthDate !== undefined) commander.birthDate = updates.birthDate;
        this.#record(commander, "updated", changed);
        this.#emit("commander_updated", commander, { changes: changed });
        return cloneCommander(commander);
    }

    assignToArmy(commanderId, armyId) {
        this.#assertActive();
        const commander = this.#commander(commanderId);
        const army = this.state.military.armies?.[requiredId(armyId, "Army ID")];
        if (!army) throw new RangeError(`Unknown army: ${armyId}`);
        if (army.countryId !== commander.countryId) throw new Error("Commander and army must belong to the same country.");
        if (commander.status !== COMMANDER_STATUS.ACTIVE) throw new Error("Only active commanders can be assigned.");
        if (army.status === "disbanded") throw new Error("Cannot assign a commander to a disbanded army.");
        if (commander.assignment?.type === "army" && commander.assignment.id === army.id) {
            return { success: true, changed: false, commander: cloneCommander(commander) };
        }
        this.#detachPreviousAssignment(commander);
        this.#releaseSlot(army, "army");
        commander.assignment = { type: "army", id: army.id };
        army.commanderId = commander.id;
        this.#record(commander, "assigned_to_army", { armyId: army.id });
        this.#emit("commander_assigned", commander, { assignment: { ...commander.assignment } });
        this.#refreshStatistics();
        return { success: true, changed: true, commander: cloneCommander(commander) };
    }

    assignToDivision(commanderId, divisionId) {
        this.#assertActive();
        const commander = this.#commander(commanderId);
        const division = this.state.military.divisions?.[requiredId(divisionId, "Division ID")];
        if (!division) throw new RangeError(`Unknown division: ${divisionId}`);
        if (division.countryId !== commander.countryId) throw new Error("Commander and division must belong to the same country.");
        if (commander.status !== COMMANDER_STATUS.ACTIVE) throw new Error("Only active commanders can be assigned.");
        if (["disbanded", "destroyed"].includes(division.status)) throw new Error("Cannot assign a commander to an inactive division.");
        if (commander.assignment?.type === "division" && commander.assignment.id === division.id) {
            return { success: true, changed: false, commander: cloneCommander(commander) };
        }
        this.#detachPreviousAssignment(commander);
        this.#releaseSlot(division, "division");
        division.commanderId = commander.id;
        commander.assignment = { type: "division", id: division.id };
        this.#record(commander, "assigned_to_division", { divisionId: division.id });
        this.#emit("commander_assigned", commander, { assignment: { ...commander.assignment } });
        this.#refreshStatistics();
        return { success: true, changed: true, commander: cloneCommander(commander) };
    }

    #detachPreviousAssignment(commander) {
        if (!commander.assignment) return;
        const { type, id } = commander.assignment;
        const registry = type === "army" ? this.state.military.armies : this.state.military.divisions;
        const previous = registry?.[id];
        if (previous?.commanderId === commander.id) previous.commanderId = null;
        commander.assignment = null;
    }

    #releaseSlot(target, assignmentType) {
        if (!target.commanderId) return;
        const previousCommander = this.state.military.commanders[target.commanderId];
        if (previousCommander?.assignment?.type === assignmentType
            && previousCommander.assignment.id === target.id) {
            previousCommander.assignment = null;
            this.#record(previousCommander, "command_relieved", {
                assignmentType,
                assignmentId: target.id
            });
        }
        target.commanderId = null;
    }

    unassign(commanderId) {
        this.#assertActive();
        const commander = this.#commander(commanderId);
        if (!commander.assignment) return { success: true, changed: false, commander: cloneCommander(commander) };
        const previous = { ...commander.assignment };
        this.#detachPreviousAssignment(commander);
        this.#record(commander, "unassigned", previous);
        this.#emit("commander_unassigned", commander, { previousAssignment: previous });
        this.#refreshStatistics();
        return { success: true, changed: true, commander: cloneCommander(commander) };
    }

    setStatus(commanderId, status) {
        this.#assertActive();
        if (!VALID_STATUSES.has(status)) throw new RangeError(`Invalid commander status: ${status}`);
        const commander = this.#commander(commanderId);
        const previousStatus = commander.status;
        if (status !== COMMANDER_STATUS.ACTIVE) this.#detachPreviousAssignment(commander);
        commander.status = status;
        this.#record(commander, "status_changed", { previousStatus, status });
        this.#emit("commander_status_changed", commander, { previousStatus, status });
        this.#refreshStatistics();
        return cloneCommander(commander);
    }

    addExperience(commanderId, amount) {
        this.#assertActive();
        if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("Experience gain must be a positive number.");
        const commander = this.#commander(commanderId);
        const previous = commander.experience;
        commander.experience = Math.min(100, previous + amount);
        this.#record(commander, "experience_gained", { amount, previous, experience: commander.experience });
        this.#emit("commander_experience_gained", commander, { amount });
        return cloneCommander(commander);
    }

    getCountryStatistics(countryId) {
        this.#assertActive();
        const commanders = this.getCommandersForCountry(countryId, { includeInactive: true });
        const active = commanders.filter(item => item.status === COMMANDER_STATUS.ACTIVE);
        return {
            total: commanders.length,
            active: active.length,
            assigned: active.filter(item => item.assignment).length,
            reserve: commanders.filter(item => item.status === COMMANDER_STATUS.RESERVE).length,
            retired: commanders.filter(item => item.status === COMMANDER_STATUS.RETIRED).length,
            averageExperience: active.length
                ? active.reduce((sum, item) => sum + item.experience, 0) / active.length : 0
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}

export default CommanderManager;

console.log("WORLD AT WAR: Commander Manager module loaded.");
