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
        this.systems = options.systems ?? {};
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
            lastAction: null,
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
                if (agent.lastAction !== null && !isRecord(agent.lastAction)) agent.lastAction = null;
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
    setSystems(systems = {}) {
        this.#assertActive();
        if (!isRecord(systems)) throw new TypeError("AI systems must be supplied as an object.");
        this.systems = { ...this.systems, ...systems };
        return Object.keys(this.systems);
    }
    #executeGoal(agent, goal) {
        const countryId = agent.countryId;
        if (goal === "technological_progress") {
            const research = this.systems.researchManager;
            if (!research) return { executed: false, reason: "research_system_unavailable" };
            const data = research.getCountryResearch(countryId);
            if (data.projects.length >= 3) return { executed: false, reason: "research_queue_full" };
            const available = research.getAvailable(countryId);
            if (!available.length) return { executed: false, reason: "no_available_technology" };
            const militaryFocus = agent.personality.militaryFocus;
            const preferred = available.filter(item => item.category === "military");
            const civilian = available.filter(item => item.category !== "military");
            const pool = militaryFocus >= 0.5 && preferred.length ? preferred : civilian.length ? civilian : available;
            pool.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
            const project = research.startResearch(countryId, pool[0].id, { priority: agent.priorities.technological_progress });
            return { executed: true, action: "research_started", technologyId: project.technologyId, cost: project.cost };
        }
        if (goal === "military_modernization") {
            const divisions = this.systems.divisionManager;
            const armies = this.systems.armyManager;
            if (!divisions || !armies) return { executed: false, reason: "military_system_unavailable" };
            const unassigned = Object.values(this.state.military.divisions)
                .filter(item => item.countryId === countryId
                    && !item.armyId
                    && !["disbanded", "destroyed"].includes(item.status))
                .sort((a, b) => a.name.localeCompare(b.name));
            if (!unassigned.length) return { executed: false, reason: "no_unassigned_active_divisions" };
            const date = currentDate(this.state);
            const dateId = date ? `${date.year}-${date.month}-${date.day}` : "undated";
            const army = armies.createArmy(countryId, "National Reserve Group", {
                id: `ai-army-${countryId}-${dateId}-${agent.decisionCount}`
            }).army;
            const assigned = [];
            for (const division of unassigned.slice(0, 5)) {
                armies.assignDivision(army.id, division.id);
                assigned.push(division.id);
            }
            return { executed: true, action: "army_formation_created", armyId: army.id, divisionIds: assigned };
        }
        if (goal === "domestic_stability") {
            const government = this.systems.politicsManager?.governments.getGovernment(countryId);
            if (!government) return { executed: false, reason: "government_baseline_unavailable" };
            if (!isRecord(this.state.politics.stabilityModifiers)) {
                this.state.politics.stabilityModifiers = Object.create(null);
            }
            const modifier = government.stability < 35 ? 0.75 : government.stability < 60 ? 0.4 : 0.1;
            this.state.politics.stabilityModifiers[countryId] = {
                ...(this.state.politics.stabilityModifiers[countryId] ?? {}),
                government: modifier
            };
            return { executed: true, action: "stability_policy_set", monthlyStabilityModifier: modifier };
        }
        if (goal === "diplomatic_security") {
            const diplomacy = this.systems.diplomacyManager;
            if (!diplomacy) return { executed: false, reason: "diplomacy_system_unavailable" };
            const candidates = Object.keys(this.state.world.countries)
                .filter(otherId => otherId !== countryId && !diplomacy.alliances.areAllied(countryId, otherId))
                .map(otherId => ({
                    countryId: otherId,
                    relation: diplomacy.relations.getValue(countryId, otherId),
                    reciprocal: diplomacy.relations.getValue(otherId, countryId)
                }))
                .filter(item => item.relation >= 65 && item.reciprocal >= 65)
                .sort((a, b) => Math.min(b.relation, b.reciprocal) - Math.min(a.relation, a.reciprocal)
                    || a.countryId.localeCompare(b.countryId));
            const partner = candidates[0];
            if (!partner) return { executed: false, reason: "no_mutually_trusted_partner" };
            const members = [countryId, partner.countryId].sort();
            const allianceId = "ai-alliance-" + members.join("-");
            if (!diplomacy.alliances.getAlliance(allianceId)) {
                const alliance = diplomacy.alliances.createAlliance({
                    id: allianceId,
                    name: members.join("–") + " Defensive Agreement",
                    type: "defensive",
                    founderId: countryId,
                    members,
                    createdAt: currentDate(this.state),
                    description: "Autonomous defensive agreement formed after sustained mutual diplomatic trust."
                });
                return { executed: true, action: "defensive_alliance_created", allianceId: alliance.id, partnerCountryId: partner.countryId };
            }
            return { executed: false, reason: "alliance_already_exists", allianceId };
        }
        if (goal === "economic_development") {
            const economy = this.systems.economyManager;
            const budget = economy?.budgets.getBudget(countryId);
            if (!economy) return { executed: false, reason: "economy_system_unavailable" };
            let budgetChanged = false;
            let civilianAllocation = budget?.allocations.civilian ?? null;
            if (budget) {
                const allocations = { ...budget.allocations };
                const target = Math.min(0.5, allocations.civilian + 0.02);
                const delta = target - allocations.civilian;
                const reducible = ["social", "administration", "diplomacy"]
                    .reduce((sum, key) => sum + allocations[key], 0);
                if (delta > 0.000001 && reducible + 0.000001 >= delta) {
                    let remaining = delta;
                    for (const key of ["social", "administration", "diplomacy"]) {
                        const cut = Math.min(allocations[key], remaining);
                        allocations[key] -= cut;
                        remaining -= cut;
                        if (remaining <= 0.000001) break;
                    }
                    allocations.civilian = target;
                    economy.budgets.setAllocations(countryId, allocations, { reason: "autonomous_ai_economic_development" });
                    budgetChanged = true;
                    civilianAllocation = target;
                }
            }
            const factories = economy.factories.list({ countryId });
            const activeProjects = economy.construction.list({ countryId, status: "active" });
            let construction = null;
            if (factories.some(factory => factory.type === "civilian") && activeProjects.length === 0) {
                const civilianLevels = factories.filter(factory => factory.type === "civilian").reduce((sum, factory) => sum + factory.level, 0);
                const militaryLevels = factories.filter(factory => factory.type === "military").reduce((sum, factory) => sum + factory.level, 0);
                const date = currentDate(this.state);
                const dateId = date ? `${date.year}-${date.month}-${date.day}` : "undated";
                construction = economy.construction.start({
                    id: `ai-construction-${countryId}-${dateId}-${agent.decisionCount}`,
                    countryId,
                    name: militaryLevels < civilianLevels ? "Military Industrial Expansion" : "Civilian Industrial Expansion",
                    factoryType: militaryLevels < civilianLevels ? "military" : "civilian",
                    cost: 100,
                    capacity: 1
                });
            }
            if (!budgetChanged && !construction) {
                return { executed: false, reason: budget ? "economic_targets_reached" : "verified_budget_unavailable" };
            }
            return { executed: true, action: construction ? "industrial_expansion_started" : "budget_reallocated",
                civilianAllocation, constructionStarted: Boolean(construction), constructionProjectId: construction?.id ?? null };
        }
        return { executed: false, reason: "goal_requires_additional_historical_data_or_policy" };
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
                const action = this.#executeGoal(agent, selected.goal);
                agent.lastAction = { ...action, goal: selected.goal, date: currentDate(this.state) };
                decision.action = { ...agent.lastAction };
                reports.push(decision);
            } else if (selected) {
                const action = this.#executeGoal(agent, selected.goal);
                agent.lastAction = { ...action, goal: selected.goal, date: currentDate(this.state) };
                reports.push({ countryId: id, goal: agent.currentGoal, decisionMade: false, action: { ...agent.lastAction }, plan: [...agent.currentPlan] });
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
        this.systems = null;
    }
}
export { GOALS as COUNTRY_AI_GOALS };
export default WorldAIManager;
