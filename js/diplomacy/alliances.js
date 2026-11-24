/* WORLD AT WAR: diplomatic alliance and membership system. */
import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const idOf = (value, label) => {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
};

export class AllianceManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.countries || !state?.diplomacy) {
            throw new TypeError("AllianceManager requires initialized world and diplomacy state.");
        }
        this.state = state;
        this.eventBus = eventBus;
        this.options = { minimumMembers: 2, ...options };
        if (!Number.isInteger(this.options.minimumMembers) || this.options.minimumMembers < 2) {
            throw new RangeError("minimumMembers must be an integer of at least two.");
        }
        if (!record(state.diplomacy.alliances)) state.diplomacy.alliances = Object.create(null);
        this.alliances = state.diplomacy.alliances;
        this.destroyed = false;
    }

    #active() { if (this.destroyed) throw new Error("AllianceManager has been destroyed."); }
    #country(countryId) {
        const id = idOf(countryId, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #touch() {
        this.state.diplomacy.statistics.activeAlliances =
            Object.values(this.alliances).filter(item => item.status === "active").length;
        markGameStateDirty(this.state);
    }
    getAlliance(allianceId) {
        this.#active();
        const alliance = this.alliances[idOf(allianceId, "Alliance ID")];
        return alliance ? structuredClone(alliance) : null;
    }
    listAlliances({ status = "active", countryId = null } = {}) {
        this.#active();
        const memberId = countryId === null ? null : this.#country(countryId);
        return Object.values(this.alliances)
            .filter(item => (!status || item.status === status) &&
                (!memberId || item.members.includes(memberId)))
            .map(item => structuredClone(item));
    }
    createAlliance(details = {}) {
        this.#active();
        if (!record(details)) throw new TypeError("Alliance details must be an object.");
        const id = idOf(details.id, "Alliance ID");
        if (this.alliances[id]) throw new Error(`Alliance already exists: ${id}`);
        const members = [...new Set((details.members ?? []).map(value => this.#country(value)))];
        if (members.length < this.options.minimumMembers) {
            throw new RangeError(`An alliance requires at least ${this.options.minimumMembers} members.`);
        }
        const date = details.createdAt ?? null;
        const alliance = {
            id,
            name: String(details.name ?? id),
            type: String(details.type ?? "defensive"),
            founderId: details.founderId ? this.#country(details.founderId) : members[0],
            members,
            status: "active",
            createdAt: date,
            dissolvedAt: null,
            description: String(details.description ?? ""),
            rules: record(details.rules) ? { ...details.rules } : {},
            history: [{ action: "created", date, members: [...members] }]
        };
        this.alliances[id] = alliance;
        this.#touch();
        this.eventBus?.emit?.(GAME_EVENTS.ALLIANCE_CREATED, { alliance: structuredClone(alliance) });
        return structuredClone(alliance);
    }
    addMember(allianceId, countryId, options = {}) {
        this.#active();
        const id = idOf(allianceId, "Alliance ID");
        const alliance = this.alliances[id];
        if (!alliance || alliance.status !== "active") throw new RangeError("Active alliance not found.");
        const memberId = this.#country(countryId);
        if (alliance.members.includes(memberId)) return this.getAlliance(id);
        alliance.members.push(memberId);
        alliance.history.push({ action: "member_joined", countryId: memberId, date: options.date ?? null });
        this.#touch();
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "alliance_member_joined", allianceId: id, countryId: memberId });
        return this.getAlliance(id);
    }
    removeMember(allianceId, countryId, options = {}) {
        this.#active();
        const id = idOf(allianceId, "Alliance ID");
        const alliance = this.alliances[id];
        if (!alliance || alliance.status !== "active") throw new RangeError("Active alliance not found.");
        const memberId = this.#country(countryId);
        if (!alliance.members.includes(memberId)) return this.getAlliance(id);
        alliance.members = alliance.members.filter(value => value !== memberId);
        alliance.history.push({ action: "member_left", countryId: memberId, date: options.date ?? null });
        if (alliance.members.length < this.options.minimumMembers) {
            alliance.status = "dissolved";
            alliance.dissolvedAt = options.date ?? null;
            this.eventBus?.emit?.(GAME_EVENTS.ALLIANCE_DISSOLVED, { allianceId: id, reason: "insufficient_members" });
        }
        this.#touch();
        return this.getAlliance(id);
    }
    dissolveAlliance(allianceId, options = {}) {
        this.#active();
        const id = idOf(allianceId, "Alliance ID");
        const alliance = this.alliances[id];
        if (!alliance || alliance.status !== "active") return false;
        alliance.status = "dissolved";
        alliance.dissolvedAt = options.date ?? null;
        alliance.history.push({ action: "dissolved", date: alliance.dissolvedAt, reason: options.reason ?? "agreement" });
        this.#touch();
        this.eventBus?.emit?.(GAME_EVENTS.ALLIANCE_DISSOLVED, { allianceId: id, alliance: structuredClone(alliance), reason: options.reason ?? "agreement" });
        return true;
    }
    areAllied(firstCountryId, secondCountryId) {
        this.#active();
        const first = this.#country(firstCountryId);
        const second = this.#country(secondCountryId);
        return Object.values(this.alliances).some(item => item.status === "active" &&
            item.members.includes(first) && item.members.includes(second));
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
        this.alliances = null;
    }
}
export default AllianceManager;
