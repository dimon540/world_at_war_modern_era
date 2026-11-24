/* WORLD AT WAR: hourly land combat simulation.
   Battle authorization is delegated to diplomacy/war systems. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

const ACTIVE = "active";
const FINISHED = "finished";
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const idOf = (value, label) => {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
};
function cloneBattle(b) {
    return {
        ...b,
        attackerDivisionIds: [...b.attackerDivisionIds],
        defenderDivisionIds: [...b.defenderDivisionIds],
        attackerLosses: { ...b.attackerLosses },
        defenderLosses: { ...b.defenderLosses },
        history: b.history.map(x => ({ ...x, date: x.date ? { ...x.date } : null }))
    };
}

export class CombatManager {
    constructor(state, divisionManager, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries || !state?.world?.provinces) {
            throw new TypeError("CombatManager requires military, country and province registries.");
        }
        if (!divisionManager || !["getDivision", "setStrength", "setOrganization", "setMorale"]
            .every(method => typeof divisionManager[method] === "function")) {
            throw new TypeError("CombatManager requires a compatible DivisionManager.");
        }
        if (!state.military.battles || typeof state.military.battles !== "object") {
            state.military.battles = Object.create(null);
        }
        this.state = state;
        this.divisionManager = divisionManager;
        this.eventBus = eventBus;
        this.hourlyOrganizationLoss = Number.isFinite(options.hourlyOrganizationLoss)
            ? clamp(options.hourlyOrganizationLoss, 0.001, 0.05) : 0.008;
        this.hourlyStrengthLoss = Number.isFinite(options.hourlyStrengthLoss)
            ? clamp(options.hourlyStrengthLoss, 0.0001, 0.01) : 0.0012;
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("CombatManager has been destroyed.");
    }
    #battle(value) {
        const id = idOf(value, "Battle ID");
        const battle = this.state.military.battles[id];
        if (!battle) throw new RangeError(`Unknown battle: ${id}`);
        return battle;
    }
    #emit(event, payload) {
        if (this.eventBus?.emit) this.eventBus.emit(event, payload);
    }
    #participants(ids, provinceId, label) {
        if (!Array.isArray(ids) || !ids.length) throw new TypeError(`${label} must contain at least one division.`);
        const unique = [...new Set(ids.map(value => idOf(value, "Division ID")))];
        if (unique.length !== ids.length) throw new Error(`${label} contains duplicate divisions.`);
        const divisions = unique.map(id => this.divisionManager.getDivision(id));
        for (const d of divisions) {
            if (["disbanded", "destroyed"].includes(d.status)) throw new Error(`Inactive division cannot fight: ${d.id}`);
            if (d.location?.provinceId && d.location.provinceId !== provinceId) {
                throw new Error(`Division ${d.id} is not located in battle province ${provinceId}.`);
            }
        }
        return divisions;
    }
    #power(divisions, side) {
        return divisions.reduce((sum, d) => {
            const s = d.stats ?? {};
            const base = side === "attacker" ? (s.attack ?? 0) + (s.breakthrough ?? 0) * 0.35
                : (s.defense ?? 0) + (s.armor ?? 0) * 0.25;
            const cmd = d.commanderId ? this.state.military.commanders?.[d.commanderId] : null;
            const skill = cmd?.skills?.[side === "attacker" ? "attack" : "defense"] ?? 0.5;
            const condition = (d.strength ?? 1) * (0.35 + (d.organization ?? 1) * 0.65)
                * (0.5 + (d.morale ?? 0.7) * 0.5);
            return sum + Math.max(0.1, base) * (0.85 + skill * 0.3) * condition
                * (0.85 + (d.experience ?? 0) * 0.3);
        }, 0);
    }
    startBattle({ provinceId, attackerDivisionIds, defenderDivisionIds,
        attackerCountryId = null, defenderCountryId = null, terrainModifier = 1, fortification = 0, id = null } = {}) {
        this.#assertActive();
        const province = idOf(provinceId, "Battle province ID");
        if (!this.state.world.provinces[province]) throw new RangeError(`Unknown battle province: ${province}`);
        if (!Number.isFinite(terrainModifier) || terrainModifier < 0.25 || terrainModifier > 2) {
            throw new RangeError("Terrain modifier must be between 0.25 and 2.");
        }
        if (!Number.isFinite(fortification) || fortification < 0 || fortification > 10) {
            throw new RangeError("Fortification must be between 0 and 10.");
        }
        const attackers = this.#participants(attackerDivisionIds, province, "Attackers");
        const defenders = this.#participants(defenderDivisionIds, province, "Defenders");
        const aCountries = [...new Set(attackers.map(d => d.countryId))];
        const dCountries = [...new Set(defenders.map(d => d.countryId))];
        if (aCountries.length !== 1 || dCountries.length !== 1) throw new Error("Each side must belong to exactly one country.");
        const aCountry = attackerCountryId ? idOf(attackerCountryId, "Attacker country ID") : aCountries[0];
        const dCountry = defenderCountryId ? idOf(defenderCountryId, "Defender country ID") : dCountries[0];
        if (aCountry !== aCountries[0] || dCountry !== dCountries[0]) throw new Error("Battle country IDs must match participant ownership.");
        if (aCountry === dCountry) throw new Error("A country cannot fight itself.");
        const battleId = id ? idOf(id, "Battle ID")
            : `battle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        if (this.state.military.battles[battleId]) throw new Error(`Battle ID already exists: ${battleId}`);
        const now = Date.now();
        const battle = {
            id: battleId, provinceId: province, attackerCountryId: aCountry, defenderCountryId: dCountry,
            attackerDivisionIds: attackers.map(d => d.id), defenderDivisionIds: defenders.map(d => d.id),
            terrainModifier, fortification, status: ACTIVE, winnerCountryId: null, elapsedHours: 0,
            attackerLosses: { manpower: 0, strength: 0 }, defenderLosses: { manpower: 0, strength: 0 },
            createdAt: now, updatedAt: now,
            history: [{ action: "battle_started", date: this.state.clock?.date ? { ...this.state.clock.date } : null }]
        };
        this.state.military.battles[battleId] = battle;
        this.#refreshActiveCount();
        this.#emit(GAME_EVENTS.BATTLE_STARTED, { battle: cloneBattle(battle) });
        return { success: true, battle: cloneBattle(battle) };
    }
    advanceBattles(hours = 1) {
        this.#assertActive();
        if (!Number.isSafeInteger(hours) || hours < 0) throw new RangeError("Battle time advance must be a non-negative whole number of hours.");
        const reports = [];
        for (const battle of Object.values(this.state.military.battles)) {
            if (battle.status !== ACTIVE) continue;
            for (let h = 0; h < hours && battle.status === ACTIVE; h += 1) {
                const attackers = battle.attackerDivisionIds.map(id => this.state.military.divisions[id])
                    .filter(d => d && !["disbanded", "destroyed"].includes(d.status));
                const defenders = battle.defenderDivisionIds.map(id => this.state.military.divisions[id])
                    .filter(d => d && !["disbanded", "destroyed"].includes(d.status));
                if (!attackers.length || !defenders.length) {
                    battle.winnerCountryId = attackers.length ? battle.attackerCountryId
                        : defenders.length ? battle.defenderCountryId : null;
                    this.#finish(battle, "side_eliminated");
                    break;
                }
                const ap = this.#power(attackers, "attacker") * battle.terrainModifier;
                const dp = this.#power(defenders, "defender") * (1 + battle.fortification * 0.08);
                const total = Math.max(0.1, ap + dp);
                const aShare = ap / total;
                const dShare = dp / total;
                for (const d of attackers) this.#applyLoss(d, this.hourlyStrengthLoss * (0.65 + dShare * 0.7),
                    this.hourlyOrganizationLoss * (0.6 + dShare * 0.8), battle.attackerLosses);
                for (const d of defenders) this.#applyLoss(d, this.hourlyStrengthLoss * (0.65 + aShare * 0.7),
                    this.hourlyOrganizationLoss * (0.6 + aShare * 0.8), battle.defenderLosses);
                battle.elapsedHours += 1;
                battle.updatedAt = Date.now();
                const aRemain = attackers.some(d => this.state.military.divisions[d.id]?.strength > 0.05
                    && this.state.military.divisions[d.id]?.organization > 0.03);
                const dRemain = defenders.some(d => this.state.military.divisions[d.id]?.strength > 0.05
                    && this.state.military.divisions[d.id]?.organization > 0.03);
                if (!aRemain || !dRemain) {
                    battle.winnerCountryId = aRemain ? battle.attackerCountryId : dRemain ? battle.defenderCountryId : null;
                    this.#finish(battle, "formation_broken");
                }
            }
            reports.push({
                battleId: battle.id, status: battle.status, elapsedHours: battle.elapsedHours,
                winnerCountryId: battle.winnerCountryId,
                attackerLosses: { ...battle.attackerLosses }, defenderLosses: { ...battle.defenderLosses }
            });
        }
        this.#refreshActiveCount();
        return reports;
    }
    #applyLoss(division, strengthRate, organizationRate, ledger) {
        const previous = division.strength ?? 1;
        const next = clamp(previous * (1 - strengthRate), 0, 1);
        ledger.manpower += Math.max(0, Math.round((division.maxManpower ?? division.manpower ?? 0) * (previous - next)));
        ledger.strength += previous - next;
        this.divisionManager.setStrength(division.id, next);
        this.divisionManager.setOrganization(division.id, clamp((division.organization ?? 1) - organizationRate, 0, 1));
        this.divisionManager.setMorale(division.id, clamp((division.morale ?? 0.7) - organizationRate * 0.25, 0, 1));
    }
    #finish(battle, reason) {
        battle.status = FINISHED;
        battle.endedAt = Date.now();
        battle.updatedAt = battle.endedAt;
        battle.endReason = reason;
        battle.history.push({
            action: "battle_ended", date: this.state.clock?.date ? { ...this.state.clock.date } : null,
            winnerCountryId: battle.winnerCountryId, reason
        });
        this.#emit(GAME_EVENTS.BATTLE_ENDED, {
            battle: cloneBattle(battle), winnerCountryId: battle.winnerCountryId, reason
        });
    }
    #refreshActiveCount() {
        this.state.military.statistics.activeBattles = Object.values(this.state.military.battles)
            .filter(b => b.status === ACTIVE).length;
    }
    getBattle(id) { this.#assertActive(); return cloneBattle(this.#battle(id)); }
    getActiveBattles() {
        this.#assertActive();
        return Object.values(this.state.military.battles).filter(b => b.status === ACTIVE).map(cloneBattle);
    }
    getCountryBattles(countryId) {
        this.#assertActive();
        const id = idOf(countryId, "Country ID");
        return Object.values(this.state.military.battles)
            .filter(b => b.attackerCountryId === id || b.defenderCountryId === id).map(cloneBattle);
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.divisionManager = null;
        this.eventBus = null;
    }
}
export default CombatManager;
