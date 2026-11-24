/* WORLD AT WAR: national GDP and macroeconomic indicators.
   Baselines must come from scenario data; no country GDP is guessed here. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value, label, min = 0) => {
    if (!Number.isFinite(value) || value < min) throw new RangeError(`${label} must be a finite number >= ${min}.`);
    return value;
};
const clone = record => ({ ...record, history: (record.history ?? []).map(item => ({ ...item, date: item.date ? { ...item.date } : null })) });

export class GDPManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.economy || !state?.world?.countries) throw new TypeError("GDPManager requires economy and country state.");
        if (!isRecord(state.economy.countries)) state.economy.countries = Object.create(null);
        this.state = state;
        this.eventBus = eventBus;
        this.maxHistory = Number.isSafeInteger(options.maxHistory) ? Math.max(12, Math.min(240, options.maxHistory)) : 60;
        this.destroyed = false;
    }
    #assertActive() { if (this.destroyed) throw new Error("GDPManager has been destroyed."); }
    #countryId(value) {
        const id = String(value ?? "").trim();
        if (!id) throw new TypeError("Country ID is required.");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #emit(countryId, record, reason) {
        this.eventBus?.emit?.(GAME_EVENTS.ECONOMY_UPDATED, { countryId, economy: clone(record), reason });
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, { reason: "gdp_updated", countryId });
    }
    initializeCountry(countryId, baseline) {
        this.#assertActive();
        const id = this.#countryId(countryId);
        if (!isRecord(baseline)) throw new TypeError("A sourced GDP baseline object is required.");
        const nominalGDP = finite(baseline.nominalGDP, "Nominal GDP");
        const population = finite(baseline.population, "Population");
        if (nominalGDP <= 0 || population <= 0) throw new RangeError("Nominal GDP and population must be greater than zero.");
        const record = {
            countryId: id,
            currency: String(baseline.currency ?? "").trim() || null,
            source: String(baseline.source ?? "").trim() || null,
            asOf: baseline.asOf ?? null,
            nominalGDP,
            realGDP: finite(baseline.realGDP ?? nominalGDP, "Real GDP"),
            population,
            gdpPerCapita: nominalGDP / population,
            annualGrowthRate: finite(baseline.annualGrowthRate ?? 0, "Annual growth rate", -1),
            inflationRate: finite(baseline.inflationRate ?? 0, "Inflation rate", -1),
            unemploymentRate: baseline.unemploymentRate == null ? null : finite(baseline.unemploymentRate, "Unemployment rate"),
            lastUpdated: Date.now(),
            history: []
        };
        this.state.economy.countries[id] = record;
        this.#emit(id, record, "baseline_initialized");
        this.#refreshWorldGDP();
        return clone(record);
    }
    setIndicators(countryId, changes = {}, options = {}) {
        this.#assertActive();
        const id = this.#countryId(countryId);
        const current = this.state.economy.countries[id];
        if (!current) throw new Error(`GDP baseline is not initialized for ${id}.`);
        if (!isRecord(changes)) throw new TypeError("GDP indicator changes must be an object.");
        const next = { ...current };
        for (const key of ["nominalGDP", "realGDP", "population", "annualGrowthRate", "inflationRate", "unemploymentRate"]) {
            if (changes[key] === undefined) continue;
            if (key === "unemploymentRate" && changes[key] === null) next[key] = null;
            else next[key] = finite(changes[key], key, ["annualGrowthRate", "inflationRate"].includes(key) ? -1 : 0);
        }
        if (next.nominalGDP <= 0 || next.population <= 0) throw new RangeError("GDP and population must remain greater than zero.");
        next.gdpPerCapita = next.nominalGDP / next.population;
        next.lastUpdated = Date.now();
        next.history = [...(current.history ?? []), {
            date: this.state.clock?.date ? { ...this.state.clock.date } : null,
            nominalGDP: next.nominalGDP,
            realGDP: next.realGDP,
            reason: String(options.reason ?? "indicator_update")
        }].slice(-this.maxHistory);
        this.state.economy.countries[id] = next;
        this.#refreshWorldGDP();
        this.#emit(id, next, options.reason ?? "indicator_update");
        return clone(next);
    }
    applyGrowth(countryId, annualGrowthRate, { days = 1, reason = "economic_growth" } = {}) {
        this.#assertActive();
        finite(days, "Growth period in days");
        if (days > 366) throw new RangeError("Growth period cannot exceed 366 days.");
        const id = this.#countryId(countryId);
        const current = this.state.economy.countries[id];
        if (!current) throw new Error(`GDP baseline is not initialized for ${id}.`);
        const rate = finite(annualGrowthRate, "Annual real growth rate", -0.99);
        const inflation = finite(current.inflationRate ?? 0, "Annual inflation rate", -0.99);
        const realFactor = Math.pow(1 + rate, days / 365);
        const nominalRate = (1 + rate) * (1 + inflation) - 1;
        const nominalFactor = Math.pow(1 + nominalRate, days / 365);
        return this.setIndicators(id, {
            nominalGDP: current.nominalGDP * nominalFactor,
            realGDP: current.realGDP * realFactor,
            annualGrowthRate: rate
        }, { reason });
    }
    getCountryGDP(countryId) {
        this.#assertActive();
        const id = this.#countryId(countryId);
        const record = this.state.economy.countries[id];
        return record ? clone(record) : null;
    }
    getWorldStatistics() {
        this.#assertActive();
        const records = Object.values(this.state.economy.countries);
        const populated = records.filter(item => Number.isFinite(item.nominalGDP) && item.population > 0);
        const totalGDP = populated.reduce((sum, item) => sum + item.nominalGDP, 0);
        const totalPopulation = populated.reduce((sum, item) => sum + item.population, 0);
        return {
            countriesWithGDPData: populated.length,
            totalCountries: Object.keys(this.state.world.countries).length,
            nominalGDP: totalGDP,
            realGDP: populated.reduce((sum, item) => sum + (item.realGDP ?? 0), 0),
            population: totalPopulation,
            weightedGDPPerCapita: totalPopulation ? totalGDP / totalPopulation : null,
            averageAnnualGrowthRate: populated.length
                ? populated.reduce((sum, item) => sum + item.annualGrowthRate, 0) / populated.length : null
        };
    }
    #refreshWorldGDP() {
        this.state.economy.statistics.worldGDP = this.getWorldStatistics().nominalGDP;
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}
export default GDPManager;
