/* WORLD AT WAR: autonomous country strategy director.
   Strategic priorities are generated from stable country IDs; historical
   economic and military figures are never fabricated by this module. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

const GOALS = Object.freeze([
    "economic_development",
    "military_modernization",
    "diplomatic_security",
    "domestic_stability",
    "technological_progress"
]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function seededUnit(seed, salt) {
    return hashString(`${seed}:${salt}`) / 0xffffffff;
}
function cloneAgent(agent) {
    return {
        ...agent,
        personality: { ...agent.personality },
        priorities: { ...agent.priorities },
        currentPlan: [...agent.currentPlan],
        recentDecisions: agent.recentDecisions.map(item => ({ ...item, date: item.date ? { ...item.date } : null }))
    };
}
function currentDate(state) {
    return state.clock?.date ? { ...state.clock.date } : null;
}

export class WorldAIManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.countries || !state?.simulation?.worldAI) {
            throw new TypeError("WorldAIManager requires country and world AI state registries.");
        }
        const aiState = state.simulation.worldAI;
        if (!isRecord(aiState.countries)) aiState.countries = Object.create(null);
        if (!isRecord(aiState.updateCounters)) aiState.updateCounters = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
        this.state = state;
        this.eventBus = eventBus;
        this.enabled = options.enabled !== false;
        this.maxDecisionHistory = Number.isSafeInteger(options.maxDecisionHistory)
            ? clamp(options.maxDecisionHistory, 10, 500) : 60;
        this.agents = aiState.countries;
        this.initialized = false;
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("WorldAIManager has been destroyed.");
    }
    #emit(type, payload) {
        this.eventBus?.emit?.(type, payload);
    }
    #makeAgent(country) {
        const seed = String(country.id);
        const personality = {
            economicFocus: 0.25 + seededUnit(seed, "economy") * 0.7,
            militaryFocus: 0.2 + seededUnit(seed, "military") * 0.75,
            diplomaticFocus: 0.2 + seededUnit(seed, "diplomacy") * 0.75,
            stabilityFocus: 0.25 + seededUnit(seed, "stability") * 0.7,
            researchFocus: 0.2 + seededUnit(seed, "research") * 0.75,
            riskTolerance: 0.15 + seededUnit(seed, "risk") * 0.8
        };
        const priorities = {
            economic_development: personality.economicFocus,
            military_modernization: personality.militaryFocus,
            diplomatic_security: personality.diplomaticFocus,
            domestic_stability: personality.stabilityFocus,
            technological_progress: personality.researchFocus
        };
        return {
            countryId: String(country.id),
            enabled: true,
            personality,
            priorities,
            currentPlan: [],
            currentGoal: null,
            decisionCount: 0,
            lastDailyUpdate: null,
            lastWeeklyReview: null,
            lastMonthlyReview: null,
            recentDecisions: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }
    initializeAgents({ reset = false } = {}) {
        this.#assertActive();
        const countries = Object.values(this.state.world.countries);
        let created = 0;
        let refreshed = 0;
        const validIds = new Set(countries.filter(country => country?.id !== undefined && country?.id !== null).map(country => String(country.id)));
        for (const country of countries) {
            if (!country || country.id === undefined || country.id === null) continue;
            const id = String(country.id);
            if (reset || !isRecord(this.agents[id])) {
                this.agents[id] = this.#makeAgent({ ...country, id });
                created += 1;
            } else {
                const agent = this.agents[id];
                const defaults = this.#makeAgent({ ...country, id });
                agent.countryId = id;
                agent.enabled = agent.enabled !== false;
                agent.personality = isRecord(agent.personality) ? { ...defaults.personality, ...agent.personality } : defaults.personality;
                const savedPriorities = isRecord(agent.priorities) ? agent.priorities : {};
                agent.priorities = Object.fromEntries(GOALS.map(goal => [
                    goal,
                    Number.isFinite(savedPriorities[goal]) ? clamp(savedPriorities[goal], 0, 1) : defaults.priorities[goal]
                ]));
                if (!Array.isArray(agent.currentPlan)) agent.currentPlan = [];
                if (!Array.isArray(agent.recentDecisions)) agent.recentDecisions = [];
                if (!Number.isSafeInteger(agent.decisionCount) || agent.decisionCount < 0) agent.decisionCount = 0;
                refreshed += 1;
            }
        }
        for (const id of Object.keys(this.agents)) {
            if (!validIds.has(id)) delete this.agents[id];
        }
        this.initialized = true;
        this.state.simulation.worldAI.enabled = this.enabled;
        return { totalCountries: countries.length, created, refreshed, agents: Object.keys(this.agents).length };
    }
    #ensureAgents() {
        const countryIds = Object.keys(this.state.world.countries);
        if (!this.initialized || countryIds.length !== Object.keys(this.agents).length
            || countryIds.some(id => !this.agents[id])) {
            this.initializeAgents();
        }
    }
    #recordDecision(agent, goal, reason, details = {}) {
        const decision = {
            id: `ai_${agent.countryId}_${agent.decisionCount + 1}`,
            countryId: agent.countryId,
            goal,
            decisionMade: true,
            reason,
            details: { ...details },
            date: currentDate(this.state),
            timestamp: Date.now()
        };
        agent.currentGoal = goal;
        agent.decisionCount += 1;
        agent.updatedAt = decision.timestamp;
        agent.recentDecisions.push(decision);
        if (agent.recentDecisions.length > this.maxDecisionHistory) {
            agent.recentDecisions.splice(0, agent.recentDecisions.length - this.maxDecisionHistory);
        }
        this.#emit(GAME_EVENTS.AI_DECISION_MADE, { decision });
        return decision;
    }
    #rankGoals(agent) {
        const entries = Object.entries(agent.priorities);
        return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([goal, score]) => ({ goal, score: Number(score.toFixed(4)) }));
    }
    runDailyCycle() {
        this.#assertActive();
        if (!this.enabled || this.state.simulation.worldAI.enabled === false) return [];
        this.#ensureAgents();
        const reports = [];
        for (const country of Object.values(this.state.world.countries)) {
            const id = String(country.id);
            const agent = this.agents[id];
            if (!agent?.enabled || country.status === "inactive" || country.status === "dissolved") continue;
            const ranking = this.#rankGoals(agent);
            agent.currentPlan = ranking.slice(0, 3).map(item => item.goal);
            const selected = ranking[0];
            const previousGoal = agent.currentGoal;
            agent.lastDailyUpdate = currentDate(this.state);
            if (selected && (previousGoal !== selected.goal || agent.decisionCount === 0)) {
                const decision = this.#recordDecision(agent, selected.goal, "highest_weighted_national_priority", {
                    score: selected.score,
                    alternatives: ranking.slice(1, 3)
                });
                reports.push(decision);
            } else {
                reports.push({ countryId: id, goal: agent.currentGoal, decisionMade: false, plan: [...agent.currentPlan] });
            }
        }
        this.state.simulation.worldAI.updateCounters.daily += 1;
        this.state.simulation.performance.countriesUpdated += reports.length;
        return reports;
    }
    runWeeklyReview() {
        this.#assertActive();
        if (!this.enabled || this.state.simulation.worldAI.enabled === false) return [];
        this.#ensureAgents();
        const reports = [];
        for (const agent of Object.values(this.agents)) {
            if (!agent.enabled || !this.state.world.countries[agent.countryId]) continue;
            if (!agent.currentGoal || !GOALS.includes(agent.currentGoal)) {
                const initialGoal = this.#rankGoals(agent)[0]?.goal;
                if (initialGoal) this.#recordDecision(agent, initialGoal, "weekly_review_initialization");
            }
            const previous = agent.priorities[agent.currentGoal] ?? 0;
            const risk = agent.personality?.riskTolerance ?? 0.5;
            const adjustment = (risk - 0.5) * 0.01;
            agent.priorities[agent.currentGoal] = clamp(previous + adjustment, 0.05, 1);
            agent.lastWeeklyReview = currentDate(this.state);
            reports.push({ countryId: agent.countryId, currentGoal: agent.currentGoal, priority: agent.priorities[agent.currentGoal] ?? 0 });
        }
        this.state.simulation.worldAI.updateCounters.weekly += 1;
        return reports;
    }
    runMonthlyReview() {
        this.#assertActive();
        if (!this.enabled || this.state.simulation.worldAI.enabled === false) return [];
        this.#ensureAgents();
        const reports = [];
        for (const agent of Object.values(this.agents)) {
            if (!agent.enabled || !this.state.world.countries[agent.countryId]) continue;
            const ranked = this.#rankGoals(agent);
            agent.currentPlan = ranked.slice(0, 3).map(item => item.goal);
            agent.lastMonthlyReview = currentDate(this.state);
            reports.push({ countryId: agent.countryId, plan: [...agent.currentPlan] });
        }
        this.state.simulation.worldAI.updateCounters.monthly += 1;
        return reports;
    }
    setCountryAI(countryId, enabled) {
        this.#assertActive();
        const id = String(countryId ?? "").trim();
        if (!id || !this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        if (typeof enabled !== "boolean") throw new TypeError("AI enabled state must be boolean.");
        this.#ensureAgents();
        this.agents[id].enabled = enabled;
        this.agents[id].updatedAt = Date.now();
        return cloneAgent(this.agents[id]);
    }
    setPriority(countryId, goal, score) {
        this.#assertActive();
        const id = String(countryId ?? "").trim();
        if (!id || !this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        if (!GOALS.includes(goal)) throw new RangeError(`Unknown strategic goal: ${goal}`);
        if (!Number.isFinite(score) || score < 0 || score > 1) throw new RangeError("Priority score must be between 0 and 1.");
        this.#ensureAgents();
        this.agents[id].priorities[goal] = score;
        this.agents[id].updatedAt = Date.now();
        return cloneAgent(this.agents[id]);
    }
    getAgent(countryId) {
        this.#assertActive();
        const id = String(countryId ?? "").trim();
        if (!id) throw new TypeError("Country ID is required.");
        this.#ensureAgents();
        const agent = this.agents[id];
        return agent ? cloneAgent(agent) : null;
    }
    getSnapshot() {
        this.#assertActive();
        this.#ensureAgents();
        const agents = Object.values(this.agents);
        return {
            enabled: this.enabled,
            totalAgents: agents.length,
            activeAgents: agents.filter(agent => agent.enabled).length,
            totalDecisions: agents.reduce((sum, agent) => sum + agent.decisionCount, 0),
            goals: [...GOALS]
        };
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
        this.agents = null;
    }
}
export { GOALS as COUNTRY_AI_GOALS };
export default WorldAIManager;
