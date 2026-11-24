/* WORLD AT WAR: national budget and treasury management.
   Initial treasury/revenue must be supplied by verified scenario data. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

export const BUDGET_CATEGORIES = Object.freeze([
    "civilian", "military", "research", "administration", "diplomacy", "social"
]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const amount = (value, label) => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number.`);
    return value;
};
function normalizeAllocations(input) {
    if (!isRecord(input)) throw new TypeError("Budget allocations must be an object.");
    const allocations = Object.fromEntries(BUDGET_CATEGORIES.map(key => [key, amount(input[key] ?? 0, `${key} allocation`)]));
    const total = Object.values(allocations).reduce((sum, value) => sum + value, 0);
    if (total > 1.500001) throw new RangeError("Budget allocations cannot exceed 150% of revenue; higher spending requires a separate debt policy.");
    return allocations;
}
function cloneBudget(budget) {
    return { ...budget, allocations: { ...budget.allocations }, monthlySpending: { ...budget.monthlySpending },
        history: budget.history.map(item => ({ ...item, date: item.date ? { ...item.date } : null })) };
}

export class BudgetManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.economy || !state?.world?.countries) throw new TypeError("BudgetManager requires economy and country state.");
        if (!isRecord(state.economy.budgets)) state.economy.budgets = Object.create(null);
        this.state = state;
        this.eventBus = eventBus;
        this.maxHistory = Number.isSafeInteger(options.maxHistory) ? Math.max(12, Math.min(240, options.maxHistory)) : 60;
        this.destroyed = false;
    }
    #assertActive() { if (this.destroyed) throw new Error("BudgetManager has been destroyed."); }
    #country(value) {
        const id = String(value ?? "").trim();
        if (!id) throw new TypeError("Country ID is required.");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #get(value) {
        const id = this.#country(value);
        const budget = this.state.economy.budgets[id];
        if (!budget) throw new Error(`Budget is not initialized for ${id}.`);
        return budget;
    }
    #emit(id, budget, reason) {
        this.eventBus?.emit?.(GAME_EVENTS.BUDGET_UPDATED, { countryId: id, budget: cloneBudget(budget), reason });
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "national_budget_updated", countryId: id });
    }
    initializeCountry(countryId, baseline) {
        this.#assertActive();
        const id = this.#country(countryId);
        if (!isRecord(baseline)) throw new TypeError("A sourced budget baseline is required.");
        const treasury = amount(baseline.treasury, "Treasury");
        const monthlyRevenue = amount(baseline.monthlyRevenue, "Monthly revenue");
        const allocations = normalizeAllocations(baseline.allocations ?? {});
        const now = Date.now();
        const budget = {
            countryId: id,
            currency: String(baseline.currency ?? "").trim() || null,
            source: String(baseline.source ?? "").trim() || null,
            asOf: baseline.asOf ?? null,
            treasury,
            monthlyRevenue,
            allocations,
            monthlySpending: Object.fromEntries(BUDGET_CATEGORIES.map(key => [key, 0])),
            deficit: 0,
            debt: amount(baseline.debt ?? 0, "Public debt"),
            lastProcessedAt: null,
            createdAt: now,
            updatedAt: now,
            history: []
        };
        this.state.economy.budgets[id] = budget;
        this.#emit(id, budget, "baseline_initialized");
        return cloneBudget(budget);
    }
    setAllocations(countryId, allocations, options = {}) {
        this.#assertActive();
        const budget = this.#get(countryId);
        const next = normalizeAllocations(allocations);
        const previous = budget.allocations;
        budget.allocations = next;
        budget.updatedAt = Date.now();
        budget.history.push({
            action: "allocations_changed",
            previous: { ...previous },
            allocations: { ...next },
            reason: String(options.reason ?? "policy_change"),
            date: this.state.clock?.date ? { ...this.state.clock.date } : null
        });
        if (budget.history.length > this.maxHistory) budget.history.splice(0, budget.history.length - this.maxHistory);
        this.#emit(budget.countryId, budget, "allocations_changed");
        return cloneBudget(budget);
    }
    setMonthlyRevenue(countryId, revenue, options = {}) {
        this.#assertActive();
        const budget = this.#get(countryId);
        budget.monthlyRevenue = amount(revenue, "Monthly revenue");
        budget.updatedAt = Date.now();
        budget.history.push({
            action: "revenue_changed", monthlyRevenue: budget.monthlyRevenue,
            reason: String(options.reason ?? "revenue_update"),
            date: this.state.clock?.date ? { ...this.state.clock.date } : null
        });
        if (budget.history.length > this.maxHistory) budget.history.splice(0, budget.history.length - this.maxHistory);
        this.#emit(budget.countryId, budget, "revenue_changed");
        return cloneBudget(budget);
    }
    processMonthly(countryId, options = {}) {
        this.#assertActive();
        const budget = this.#get(countryId);
        const revenue = budget.monthlyRevenue;
        const spending = Object.fromEntries(BUDGET_CATEGORIES.map(key => [
            key, revenue * budget.allocations[key]
        ]));
        const totalSpending = Object.values(spending).reduce((sum, value) => sum + value, 0);
        const deficit = Math.max(0, totalSpending - revenue);
        const surplus = Math.max(0, revenue - totalSpending);
        budget.treasury += surplus - deficit;
        budget.debt += deficit;
        budget.deficit = deficit;
        budget.monthlySpending = spending;
        budget.lastProcessedAt = Date.now();
        budget.updatedAt = budget.lastProcessedAt;
        budget.history.push({
            action: "monthly_budget_processed", revenue, totalSpending, surplus, deficit,
            date: this.state.clock?.date ? { ...this.state.clock.date } : null
        });
        if (budget.history.length > this.maxHistory) budget.history.splice(0, budget.history.length - this.maxHistory);
        this.#emit(budget.countryId, budget, options.reason ?? "monthly_budget_processed");
        return { ...cloneBudget(budget), revenue, totalSpending, surplus, deficit };
    }
    getBudget(countryId) {
        this.#assertActive();
        const id = this.#country(countryId);
        const budget = this.state.economy.budgets[id];
        return budget ? cloneBudget(budget) : null;
    }
    getWorldStatistics() {
        this.#assertActive();
        const budgets = Object.values(this.state.economy.budgets);
        return {
            countriesWithBudgets: budgets.length,
            totalTreasury: budgets.reduce((sum, item) => sum + item.treasury, 0),
            totalMonthlyRevenue: budgets.reduce((sum, item) => sum + item.monthlyRevenue, 0),
            totalPublicDebt: budgets.reduce((sum, item) => sum + item.debt, 0),
            countriesInDeficit: budgets.filter(item => item.deficit > 0).length
        };
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}
export default BudgetManager;
