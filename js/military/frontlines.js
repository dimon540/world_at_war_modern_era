/* WORLD AT WAR: frontline organization.
   Frontlines group armies and ordered province sectors; this module does not invent borders. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

const STATUSES = Object.freeze({ ACTIVE: "active", INACTIVE: "inactive", DISBANDED: "disbanded" });
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
function idOf(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}
function cloneFront(front) {
    return { ...front, provinceIds: [...front.provinceIds], armyIds: [...front.armyIds],
        history: front.history.map(item => ({ ...item, date: item.date ? { ...item.date } : null })) };
}

export class FrontlineManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries || !state?.world?.provinces) {
            throw new TypeError("FrontlineManager requires military, country and province registries.");
        }
        if (!isRecord(state.military.fronts)) state.military.fronts = Object.create(null);
        this.state = state;
        this.eventBus = eventBus;
        this.maxHistory = Number.isSafeInteger(options.maxHistory) && options.maxHistory > 0 ? options.maxHistory : 100;
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("FrontlineManager has been destroyed.");
    }
    #country(value) {
        const id = idOf(value, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #front(value) {
        const id = idOf(value, "Frontline ID");
        const front = this.state.military.fronts[id];
        if (!front) throw new RangeError(`Unknown frontline: ${id}`);
        return front;
    }
    #record(front, action, details = {}) {
        front.updatedAt = Date.now();
        front.history.push({ action, date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: { ...details } });
        if (front.history.length > this.maxHistory) front.history.splice(0, front.history.length - this.maxHistory);
    }
    #emit(type, payload) {
        if (this.eventBus?.emit) this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, { type, ...payload });
    }
    createFrontline({ countryId, enemyCountryId, name, provinceIds = [], armyIds = [], id = null } = {}) {
        this.#assertActive();
        const owner = this.#country(countryId);
        const enemy = this.#country(enemyCountryId);
        if (owner === enemy) throw new Error("A frontline requires two different countries.");
        const title = String(name ?? "").trim();
        if (!title) throw new TypeError("Frontline name is required.");
        if (!Array.isArray(provinceIds) || !Array.isArray(armyIds)) throw new TypeError("Province and army IDs must be arrays.");
        const provinces = [...new Set(provinceIds.map((value, i) => {
            const provinceId = idOf(value, `Province ${i + 1}`);
            if (!this.state.world.provinces[provinceId]) throw new RangeError(`Unknown province: ${provinceId}`);
            return provinceId;
        }))];
        const armies = [...new Set(armyIds.map(value => idOf(value, "Army ID")))];
        for (const armyId of armies) {
            const army = this.state.military.armies?.[armyId];
            if (!army) throw new RangeError(`Unknown army: ${armyId}`);
            if (army.countryId !== owner) throw new Error("Every assigned army must belong to the frontline country.");
        }
        const frontId = id ? idOf(id, "Frontline ID")
            : `front_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        if (this.state.military.fronts[frontId]) throw new Error(`Frontline ID already exists: ${frontId}`);
        const now = Date.now();
        const front = {
            id: frontId, name: title, countryId: owner, enemyCountryId: enemy,
            status: STATUSES.ACTIVE, provinceIds: provinces, armyIds: [],
            createdAt: now, updatedAt: now,
            history: [{ action: "created", date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: {} }]
        };
        this.state.military.fronts[frontId] = front;
        for (const armyId of armies) this.assignArmy(frontId, armyId);
        this.state.military.statistics.activeFronts = Object.values(this.state.military.fronts)
            .filter(item => item.status === STATUSES.ACTIVE).length;
        this.#emit(GAME_EVENTS.FRONT_CREATED, { frontline: cloneFront(front) });
        return { success: true, frontline: cloneFront(front) };
    }
    getFrontline(frontlineId) {
        this.#assertActive();
        return cloneFront(this.#front(frontlineId));
    }
    getFrontlinesForCountry(countryId, { includeInactive = false } = {}) {
        this.#assertActive();
        const owner = this.#country(countryId);
        return Object.values(this.state.military.fronts).filter(front => front.countryId === owner)
            .filter(front => includeInactive || front.status === STATUSES.ACTIVE)
            .sort((a, b) => a.name.localeCompare(b.name)).map(cloneFront);
    }
    addProvince(frontlineId, provinceId, index = null) {
        this.#assertActive();
        const front = this.#front(frontlineId);
        const id = idOf(provinceId, "Province ID");
        if (!this.state.world.provinces[id]) throw new RangeError(`Unknown province: ${id}`);
        if (front.provinceIds.includes(id)) return cloneFront(front);
        if (index === null) front.provinceIds.push(id);
        else {
            if (!Number.isSafeInteger(index) || index < 0 || index > front.provinceIds.length) throw new RangeError("Frontline province index is out of range.");
            front.provinceIds.splice(index, 0, id);
        }
        this.#record(front, "province_added", { provinceId: id, index });
        this.#emit("frontline_updated", { frontlineId: front.id, countryId: front.countryId });
        return cloneFront(front);
    }
    removeProvince(frontlineId, provinceId) {
        this.#assertActive();
        const front = this.#front(frontlineId);
        const id = idOf(provinceId, "Province ID");
        const previousLength = front.provinceIds.length;
        front.provinceIds = front.provinceIds.filter(item => item !== id);
        if (front.provinceIds.length !== previousLength) this.#record(front, "province_removed", { provinceId: id });
        this.#emit("frontline_updated", { frontlineId: front.id, countryId: front.countryId });
        return cloneFront(front);
    }
    assignArmy(frontlineId, armyId) {
        this.#assertActive();
        const front = this.#front(frontlineId);
        const id = idOf(armyId, "Army ID");
        const army = this.state.military.armies?.[id];
        if (!army) throw new RangeError(`Unknown army: ${id}`);
        if (army.countryId !== front.countryId) throw new Error("Army and frontline must belong to the same country.");
        if (front.status !== STATUSES.ACTIVE) throw new Error("Only active frontlines can receive armies.");
        if (front.armyIds.includes(id)) return cloneFront(front);
        if (army.frontlineId && this.state.military.fronts[army.frontlineId]) {
            const previous = this.state.military.fronts[army.frontlineId];
            previous.armyIds = previous.armyIds.filter(item => item !== id);
            this.#record(previous, "army_reassigned", { armyId: id, toFrontlineId: front.id });
        }
        front.armyIds.push(id);
        army.frontlineId = front.id;
        this.#record(front, "army_assigned", { armyId: id });
        this.#emit("frontline_updated", { frontlineId: front.id, countryId: front.countryId, armyId: id });
        return cloneFront(front);
    }
    removeArmy(frontlineId, armyId) {
        this.#assertActive();
        const front = this.#front(frontlineId);
        const id = idOf(armyId, "Army ID");
        front.armyIds = front.armyIds.filter(item => item !== id);
        const army = this.state.military.armies?.[id];
        if (army?.frontlineId === front.id) delete army.frontlineId;
        this.#record(front, "army_removed", { armyId: id });
        this.#emit("frontline_updated", { frontlineId: front.id, countryId: front.countryId, armyId: id });
        return cloneFront(front);
    }
    setStatus(frontlineId, status) {
        this.#assertActive();
        if (!Object.values(STATUSES).includes(status)) throw new RangeError(`Invalid frontline status: ${status}`);
        const front = this.#front(frontlineId);
        const previousStatus = front.status;
        front.status = status;
        if (status === STATUSES.DISBANDED) {
            for (const armyId of front.armyIds) {
                const army = this.state.military.armies?.[armyId];
                if (army?.frontlineId === front.id) delete army.frontlineId;
            }
            front.armyIds = [];
        }
        this.#record(front, "status_changed", { previousStatus, status });
        this.state.military.statistics.activeFronts = Object.values(this.state.military.fronts)
            .filter(item => item.status === STATUSES.ACTIVE).length;
        this.#emit("frontline_updated", { frontlineId: front.id, countryId: front.countryId, status });
        return cloneFront(front);
    }
    getFrontlineStrength(frontlineId) {
        this.#assertActive();
        const front = this.#front(frontlineId);
        const divisions = front.armyIds.flatMap(id => this.state.military.armies?.[id]?.divisionIds ?? [])
            .map(id => this.state.military.divisions?.[id])
            .filter(d => d && !["disbanded", "destroyed"].includes(d.status));
        return {
            frontlineId: front.id,
            armies: front.armyIds.length,
            divisions: divisions.length,
            personnel: divisions.reduce((sum, d) => sum + (d.manpower ?? 0), 0),
            averageOrganization: divisions.length ? divisions.reduce((sum, d) => sum + (d.organization ?? 0), 0) / divisions.length : 0
        };
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}
export { STATUSES as FRONTLINE_STATUS };
export default FrontlineManager;
