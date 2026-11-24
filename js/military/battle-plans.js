/* WORLD AT WAR: operational battle plans.
   Routes are explicitly supplied by the scenario/player; adjacency is never guessed. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

export const BATTLE_PLAN_STATUS = Object.freeze({
    DRAFT: "draft",
    ACTIVE: "active",
    PAUSED: "paused",
    COMPLETED: "completed",
    CANCELLED: "cancelled"
});
const VALID_STATUS = new Set(Object.values(BATTLE_PLAN_STATUS));
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const requiredId = (value, label) => {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
};
function clonePlan(plan) {
    return {
        ...plan,
        armyIds: [...plan.armyIds],
        objectiveProvinceIds: [...plan.objectiveProvinceIds],
        divisionOrders: Object.fromEntries(Object.entries(plan.divisionOrders).map(([id, order]) => [
            id, { ...order, route: [...order.route] }
        ])),
        history: plan.history.map(item => ({ ...item, details: { ...item.details },
            date: item.date ? { ...item.date } : null }))
    };
}

export class BattlePlanManager {
    constructor(state, armyManager, frontlineManager, movementManager, eventBus = gameEventBus) {
        if (!state?.military || !state?.world?.countries || !state?.world?.provinces) {
            throw new TypeError("BattlePlanManager requires military, country and province registries.");
        }
        if (!armyManager || typeof armyManager.getArmy !== "function") {
            throw new TypeError("BattlePlanManager requires an ArmyManager.");
        }
        if (!frontlineManager || typeof frontlineManager.getFrontline !== "function") {
            throw new TypeError("BattlePlanManager requires a FrontlineManager.");
        }
        if (!movementManager || !["issueMoveOrder", "cancelMoveOrder", "getMoveOrder"].every(
            method => typeof movementManager[method] === "function")) {
            throw new TypeError("BattlePlanManager requires a MovementManager.");
        }
        if (!isRecord(state.military.battlePlans)) state.military.battlePlans = Object.create(null);
        this.state = state;
        this.armyManager = armyManager;
        this.frontlineManager = frontlineManager;
        this.movementManager = movementManager;
        this.eventBus = eventBus;
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("BattlePlanManager has been destroyed.");
    }
    #plan(value) {
        const id = requiredId(value, "Battle plan ID");
        const plan = this.state.military.battlePlans[id];
        if (!plan) throw new RangeError(`Unknown battle plan: ${id}`);
        return plan;
    }
    #country(value) {
        const id = requiredId(value, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #record(plan, action, details = {}) {
        plan.updatedAt = Date.now();
        plan.history.push({
            action,
            date: this.state.clock?.date ? { ...this.state.clock.date } : null,
            details: { ...details }
        });
        if (plan.history.length > 150) plan.history.shift();
    }
    #emit(type, payload) {
        if (this.eventBus?.emit) this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, { type, ...payload });
    }
    createPlan({ countryId, name, frontlineId = null, armyIds = [], objectiveProvinceIds = [], id = null } = {}) {
        this.#assertActive();
        const owner = this.#country(countryId);
        const title = String(name ?? "").trim();
        if (!title) throw new TypeError("Battle plan name is required.");
        if (!Array.isArray(armyIds) || !Array.isArray(objectiveProvinceIds)) {
            throw new TypeError("Army and objective IDs must be arrays.");
        }
        const front = frontlineId ? this.frontlineManager.getFrontline(frontlineId) : null;
        if (front && front.countryId !== owner) throw new Error("Frontline belongs to another country.");
        const armies = [...new Set(armyIds.map(value => requiredId(value, "Army ID")))];
        for (const armyId of armies) {
            const army = this.armyManager.getArmy(armyId);
            if (army.countryId !== owner || army.status === "disbanded") {
                throw new Error("Every assigned army must be active and belong to the plan country.");
            }
            if (frontlineId && !front.armyIds.includes(armyId)) {
                throw new Error(`Army ${armyId} is not assigned to frontline ${frontlineId}.`);
            }
        }
        const objectives = [...new Set(objectiveProvinceIds.map(value => {
            const provinceId = requiredId(value, "Objective province ID");
            if (!this.state.world.provinces[provinceId]) throw new RangeError(`Unknown objective province: ${provinceId}`);
            return provinceId;
        }))];
        const planId = id ? requiredId(id, "Battle plan ID")
            : `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        if (this.state.military.battlePlans[planId]) throw new Error(`Battle plan ID already exists: ${planId}`);
        const now = Date.now();
        const plan = {
            id: planId, name: title, countryId: owner, frontlineId,
            status: BATTLE_PLAN_STATUS.DRAFT, armyIds: armies,
            objectiveProvinceIds: objectives, divisionOrders: {},
            createdAt: now, updatedAt: now,
            history: [{ action: "created", date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: {} }]
        };
        this.state.military.battlePlans[planId] = plan;
        this.#emit("battle_plan_created", { plan: clonePlan(plan) });
        return { success: true, plan: clonePlan(plan) };
    }
    getPlan(planId) {
        this.#assertActive();
        return clonePlan(this.#plan(planId));
    }
    getPlansForCountry(countryId, { includeInactive = true } = {}) {
        this.#assertActive();
        const owner = this.#country(countryId);
        return Object.values(this.state.military.battlePlans)
            .filter(plan => plan.countryId === owner)
            .filter(plan => includeInactive || [BATTLE_PLAN_STATUS.DRAFT, BATTLE_PLAN_STATUS.ACTIVE, BATTLE_PLAN_STATUS.PAUSED].includes(plan.status))
            .sort((a, b) => b.createdAt - a.createdAt).map(clonePlan);
    }
    assignArmy(planId, armyId) {
        this.#assertActive();
        const plan = this.#plan(planId);
        if (![BATTLE_PLAN_STATUS.DRAFT, BATTLE_PLAN_STATUS.ACTIVE, BATTLE_PLAN_STATUS.PAUSED].includes(plan.status)) {
            throw new Error("Cannot change armies on a closed battle plan.");
        }
        const army = this.armyManager.getArmy(armyId);
        if (army.countryId !== plan.countryId || army.status === "disbanded") {
            throw new Error("Army must be active and belong to the plan country.");
        }
        if (plan.frontlineId) {
            const front = this.frontlineManager.getFrontline(plan.frontlineId);
            if (!front.armyIds.includes(army.id)) throw new Error("Army is not assigned to this plan's frontline.");
        }
        if (!plan.armyIds.includes(army.id)) {
            plan.armyIds.push(army.id);
            this.#record(plan, "army_assigned", { armyId: army.id });
            this.#emit("battle_plan_updated", { planId: plan.id, armyId: army.id });
        }
        return clonePlan(plan);
    }
    removeArmy(planId, armyId) {
        this.#assertActive();
        const plan = this.#plan(planId);
        const id = requiredId(armyId, "Army ID");
        const army = this.armyManager.getArmy(id);
        if (army.countryId !== plan.countryId) throw new Error("Army belongs to another country.");
        const activeOrders = Object.keys(plan.divisionOrders).filter(divisionId =>
            army.divisionIds.includes(divisionId) && this.movementManager.getMoveOrder(divisionId)
        );
        if (activeOrders.length) {
            throw new Error("Cancel or complete this army's active division orders before removing it.");
        }
        for (const divisionId of Object.keys(plan.divisionOrders)) {
            if (army.divisionIds.includes(divisionId)) delete plan.divisionOrders[divisionId];
        }
        plan.armyIds = plan.armyIds.filter(item => item !== id);
        this.#record(plan, "army_removed", { armyId: id });
        this.#emit("battle_plan_updated", { planId: plan.id, armyId: id });
        return clonePlan(plan);
    }
    setStatus(planId, status) {
        this.#assertActive();
        if (!VALID_STATUS.has(status)) throw new RangeError(`Invalid battle plan status: ${status}`);
        const plan = this.#plan(planId);
        if ([BATTLE_PLAN_STATUS.COMPLETED, BATTLE_PLAN_STATUS.CANCELLED].includes(plan.status)
            && status !== plan.status) throw new Error("Closed battle plans cannot be reopened.");
        if (status === BATTLE_PLAN_STATUS.COMPLETED) {
            const progress = this.getProgress(plan.id);
            if (progress.activeOrders > 0 || progress.completedOrders !== progress.totalOrders) {
                throw new Error("A battle plan can only be completed after all issued division orders have reached their destinations.");
            }
        }
        const previousStatus = plan.status;
        if (status === BATTLE_PLAN_STATUS.CANCELLED) {
            for (const divisionId of Object.keys(plan.divisionOrders)) {
                if (this.movementManager.getMoveOrder(divisionId)) {
                    this.movementManager.cancelMoveOrder(divisionId);
                }
                plan.divisionOrders[divisionId].status = "cancelled";
            }
        }
        plan.status = status;
        this.#record(plan, "status_changed", { previousStatus, status });
        this.#emit("battle_plan_updated", { planId: plan.id, status });
        return clonePlan(plan);
    }
    issueDivisionOrder(planId, divisionId, route, options = {}) {
        this.#assertActive();
        const plan = this.#plan(planId);
        if (![BATTLE_PLAN_STATUS.DRAFT, BATTLE_PLAN_STATUS.ACTIVE].includes(plan.status)) {
            throw new Error("Only draft or active plans can issue movement orders.");
        }
        if (!Array.isArray(route) || route.length < 1) throw new TypeError("A division route must contain province IDs.");
        if (!isRecord(options)) throw new TypeError("Movement options must be an object.");
        const id = requiredId(divisionId, "Division ID");
        const division = this.state.military.divisions?.[id];
        if (!division || division.countryId !== plan.countryId || ["disbanded", "destroyed"].includes(division.status)) {
            throw new Error("Division must be active and belong to the plan country.");
        }
        const armyId = division.armyId;
        if (!armyId || !plan.armyIds.includes(armyId)) {
            throw new Error("Division must belong to an army assigned to this battle plan.");
        }
        const normalizedRoute = route.map(value => {
            const provinceId = requiredId(value, "Route province ID");
            if (!this.state.world.provinces[provinceId]) throw new RangeError(`Unknown route province: ${provinceId}`);
            return provinceId;
        });
        if (plan.objectiveProvinceIds.length
            && !plan.objectiveProvinceIds.includes(normalizedRoute.at(-1))) {
            throw new Error("Division route must end at one of this battle plan's objective provinces.");
        }
        const order = this.movementManager.issueMoveOrder(id, normalizedRoute, {
            ...options,
            source: "battle_plan"
        });
        plan.divisionOrders[id] = {
            divisionId: id, armyId, route: normalizedRoute,
            movementOrderId: order.id, status: order.status, issuedAt: Date.now()
        };
        if (plan.status === BATTLE_PLAN_STATUS.DRAFT) plan.status = BATTLE_PLAN_STATUS.ACTIVE;
        this.#record(plan, "division_order_issued", { divisionId: id, armyId, route: normalizedRoute });
        this.#emit("battle_plan_order_issued", { planId: plan.id, divisionId: id, armyId });
        return { success: true, plan: clonePlan(plan), order };
    }
    cancelDivisionOrder(planId, divisionId) {
        this.#assertActive();
        const plan = this.#plan(planId);
        const id = requiredId(divisionId, "Division ID");
        const entry = plan.divisionOrders[id];
        if (!entry) return { success: false, reason: "order_not_found" };
        const cancelled = this.movementManager.cancelMoveOrder(id);
        entry.status = "cancelled";
        this.#record(plan, "division_order_cancelled", { divisionId: id });
        this.#emit("battle_plan_updated", { planId: plan.id, divisionId: id });
        return { success: true, cancelled, plan: clonePlan(plan) };
    }
    getProgress(planId) {
        this.#assertActive();
        const plan = this.#plan(planId);
        const orders = Object.values(plan.divisionOrders).map(entry => {
            const division = this.state.military.divisions?.[entry.divisionId];
            const activeOrder = this.movementManager.getMoveOrder(entry.divisionId);
            const currentProvinceId = division?.location?.provinceId ?? null;
            const complete = entry.status !== "cancelled" && !activeOrder
                && currentProvinceId === entry.route.at(-1);
            return { divisionId: entry.divisionId, armyId: entry.armyId,
                status: complete ? "completed" : activeOrder ? activeOrder.status : entry.status,
                currentProvinceId, destinationProvinceId: entry.route.at(-1),
                remainingProvinces: activeOrder ? Math.max(0, activeOrder.route.length - 1 - activeOrder.currentIndex) : 0 };
        });
        const completed = orders.filter(order => order.status === "completed").length;
        return { planId: plan.id, totalOrders: orders.length, completedOrders: completed,
            activeOrders: orders.filter(order => order.status === "active").length,
            orders };
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.armyManager = null;
        this.frontlineManager = null;
        this.movementManager = null;
        this.eventBus = null;
    }
}
export default BattlePlanManager;
