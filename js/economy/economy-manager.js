/* WORLD AT WAR: national economy orchestration. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";
import { GDPManager } from "./gdp.js";
import { BudgetManager } from "./budget.js";

export class EconomyManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.economy || !state?.world?.countries) throw new TypeError("EconomyManager requires economy and world state.");
        this.state = state;
        this.eventBus = eventBus;
        this.gdp = new GDPManager(state, eventBus, options.gdp);
        this.budgets = new BudgetManager(state, eventBus, options.budget);
        this.destroyed = false;
    }
    #assertActive() { if (this.destroyed) throw new Error("EconomyManager has been destroyed."); }
    initializeCountry(countryId, { gdp = null, budget = null } = {}) {
        this.#assertActive();
        const result = {};
        if (gdp) result.gdp = this.gdp.initializeCountry(countryId, gdp);
        if (budget) result.budget = this.budgets.initializeCountry(countryId, budget);
        if (!gdp && !budget) throw new TypeError("At least one sourced GDP or budget baseline is required.");
        return { success: true, countryId: String(countryId), ...result };
    }
    processMonthly() {
        this.#assertActive();
        const budgetReports = [];
        for (const countryId of Object.keys(this.state.economy.budgets)) {
            budgetReports.push(this.budgets.processMonthly(countryId));
        }
        const gdpReports = [];
        for (const [countryId, record] of Object.entries(this.state.economy.countries)) {
            if (!Number.isFinite(record.annualGrowthRate)) continue;
            gdpReports.push(this.gdp.applyGrowth(countryId, record.annualGrowthRate, {
                days: 30,
                reason: "monthly_economic_simulation"
            }));
        }
        const report = {
            countriesWithGDP: gdpReports.length,
            countriesWithBudgets: budgetReports.length,
            gdp: this.gdp.getWorldStatistics(),
            budget: this.budgets.getWorldStatistics()
        };
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "monthly_economy_processed", report });
        return { ...report, budgetReports };
    }
    getCountryOverview(countryId) {
        this.#assertActive();
        const id = String(countryId ?? "").trim();
        if (!id || !this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return { countryId: id, gdp: this.gdp.getCountryGDP(id), budget: this.budgets.getBudget(id) };
    }
    getWorldStatistics() {
        this.#assertActive();
        return { gdp: this.gdp.getWorldStatistics(), budget: this.budgets.getWorldStatistics() };
    }
    destroy() {
        if (this.destroyed) return;
        this.gdp.destroy();
        this.budgets.destroy();
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}
export default EconomyManager;
