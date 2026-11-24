/* WORLD AT WAR: declaration, participation and lifecycle of interstate wars. */
import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const requireId = (value, label) => {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
};

export class WarManager {
    constructor(state, eventBus = gameEventBus) {
        if (!state?.world?.countries || !state?.diplomacy) throw new TypeError("WarManager requires initialized world and diplomacy state.");
        this.state = state;
        this.eventBus = eventBus;
        if (!isRecord(state.diplomacy.wars)) state.diplomacy.wars = Object.create(null);
        this.wars = state.diplomacy.wars;
        this.destroyed = false;
    }
    #active() { if (this.destroyed) throw new Error("WarManager has been destroyed."); }
    #country(value) {
        const id = requireId(value, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #sync() {
        this.state.diplomacy.statistics.activeWars = Object.values(this.wars).filter(w => w.status === "active").length;
        markGameStateDirty(this.state);
    }
    getWar(warId) {
        this.#active();
        const war = this.wars[requireId(warId, "War ID")];
        return war ? structuredClone(war) : null;
    }
    listWars({ status = null, countryId = null } = {}) {
        this.#active();
        const member = countryId === null ? null : this.#country(countryId);
        return Object.values(this.wars).filter(w => (!status || w.status === status) &&
            (!member || w.participants.some(p => p.countryId === member)))
            .map(w => structuredClone(w));
    }
    declareWar({ id, name, attackerId, defenderId, date = null, casusBelli = "unspecified", goals = [] } = {}) {
        this.#active();
        const warId = requireId(id, "War ID");
        if (this.wars[warId]) throw new Error(`War already exists: ${warId}`);
        const attacker = this.#country(attackerId);
        const defender = this.#country(defenderId);
        if (attacker === defender) throw new RangeError("A country cannot declare war on itself.");
        const war = {
            id: warId,
            name: String(name ?? `${attacker}–${defender} War`),
            status: "active",
            startedAt: date,
            endedAt: null,
            casusBelli: String(casusBelli),
            goals: Array.isArray(goals) ? [...goals] : [],
            participants: [
                { countryId: attacker, side: "attacker", joinedAt: date, leftAt: null, capitulated: false },
                { countryId: defender, side: "defender", joinedAt: date, leftAt: null, capitulated: false }
            ],
            battles: [],
            outcome: null,
            history: [{ action: "war_declared", date, attackerId: attacker, defenderId: defender }]
        };
        this.wars[warId] = war;
        this.#sync();
        this.eventBus?.emit?.(GAME_EVENTS.WAR_DECLARED, { war: structuredClone(war), attackerId: attacker, defenderId: defender });
        return structuredClone(war);
    }
    joinWar(warId, countryId, side, options = {}) {
        this.#active();
        const war = this.wars[requireId(warId, "War ID")];
        if (!war || war.status !== "active") throw new RangeError("Active war not found.");
        const member = this.#country(countryId);
        if (side !== "attacker" && side !== "defender") throw new RangeError("War side must be attacker or defender.");
        const existing = war.participants.find(p => p.countryId === member);
        if (existing) {
            if (existing.side !== side) throw new Error("A participant cannot change sides during an active war.");
            return structuredClone(war);
        }
        war.participants.push({ countryId: member, side, joinedAt: options.date ?? null, leftAt: null, capitulated: false });
        war.history.push({ action: "joined", countryId: member, side, date: options.date ?? null });
        this.#sync();
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "war_participant_joined", warId, countryId: member, side });
        return structuredClone(war);
    }
    recordBattle(warId, battle) {
        this.#active();
        const war = this.wars[requireId(warId, "War ID")];
        if (!war || war.status !== "active") throw new RangeError("Active war not found.");
        if (!isRecord(battle) || !battle.id) throw new TypeError("Battle record with an ID is required.");
        if (war.battles.some(item => item.id === battle.id)) throw new Error("Battle is already recorded in this war.");
        const entry = { ...battle, date: battle.date ?? null };
        war.battles.push(entry);
        war.history.push({ action: "battle_recorded", battleId: entry.id, date: entry.date });
        markGameStateDirty(this.state);
        return structuredClone(entry);
    }
    setCapitulation(warId, countryId, options = {}) {
        this.#active();
        const war = this.wars[requireId(warId, "War ID")];
        if (!war || war.status !== "active") throw new RangeError("Active war not found.");
        const member = this.#country(countryId);
        const participant = war.participants.find(p => p.countryId === member);
        if (!participant) throw new RangeError("Country is not a participant in this war.");
        participant.capitulated = true;
        participant.leftAt = options.date ?? null;
        war.history.push({ action: "capitulated", countryId: member, date: options.date ?? null });
        markGameStateDirty(this.state);
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "war_capitulation", warId, countryId: member });
        return structuredClone(war);
    }
    endWar(warId, { date = null, outcome = "white_peace", terms = [] } = {}) {
        this.#active();
        const id = requireId(warId, "War ID");
        const war = this.wars[id];
        if (!war || war.status !== "active") return false;
        war.status = "ended";
        war.endedAt = date;
        war.outcome = { type: String(outcome), terms: Array.isArray(terms) ? [...terms] : [] };
        war.history.push({ action: "war_ended", date, outcome: war.outcome });
        this.#sync();
        this.eventBus?.emit?.(GAME_EVENTS.WAR_ENDED, { war: structuredClone(war) });
        return structuredClone(war);
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
        this.wars = null;
    }
}
export default WarManager;
