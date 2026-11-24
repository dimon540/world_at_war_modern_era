import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { WorldAIManager } from "../js/ai/world-ai-manager.js";
import { ResearchManager } from "../js/technology/research-manager.js";
import { EconomyManager } from "../js/economy/economy-manager.js";
import { DiplomacyManager } from "../js/diplomacy/diplomacy-manager.js";

function makeState() {
    const state = createInitialGameState();
    state.world.countries.AAA = { id: "AAA", name: "Alpha" };
    return state;
}

function forceGoal(ai, countryId, goal) {
    for (const item of ["economic_development", "military_modernization", "diplomatic_security", "domestic_stability", "technological_progress"]) {
        ai.setPriority(countryId, item, item === goal ? 1 : 0);
    }
}

test("AI research priority starts a real eligible technology project", () => {
    const state = makeState();
    const ai = new WorldAIManager(state);
    const research = new ResearchManager(state);
    ai.setSystems({ researchManager: research });
    ai.initializeAgents();
    forceGoal(ai, "AAA", "technological_progress");

    const reports = ai.runDailyCycle();
    const data = research.getCountryResearch("AAA");

    assert.equal(data.projects.length, 1);
    assert.equal(reports[0].action.executed, true);
    assert.equal(reports[0].action.action, "research_started");
    assert.equal(data.projects[0].technologyId, reports[0].action.technologyId);

    ai.destroy();
    research.destroy();
});

test("AI economic priority reallocates an existing verified national budget", () => {
    const state = makeState();
    const ai = new WorldAIManager(state);
    const economy = new EconomyManager(state);
    economy.budgets.initializeCountry("AAA", {
        treasury: 1000,
        monthlyRevenue: 100,
        currency: "USD",
        source: "test fixture",
        asOf: "2000-01-01",
        allocations: { civilian: 0.2, military: 0.2, research: 0.1, administration: 0.1, diplomacy: 0.1, social: 0.1 }
    });
    ai.setSystems({ economyManager: economy });
    ai.initializeAgents();
    forceGoal(ai, "AAA", "economic_development");

    const report = ai.runDailyCycle()[0];
    const budget = economy.budgets.getBudget("AAA");

    assert.equal(report.action.executed, true);
    assert.ok(budget.allocations.civilian > 0.2);
    assert.equal(report.action.action, "budget_reallocated");

    ai.destroy();
    economy.destroy();
});

test("AI diplomatic priority creates a defensive alliance from reciprocal trust", () => {
    const state = makeState();
    state.world.countries.BBB = { id: "BBB", name: "Bravo" };
    const ai = new WorldAIManager(state);
    const diplomacy = new DiplomacyManager(state);
    diplomacy.relations.setRelation("AAA", "BBB", 75);
    diplomacy.relations.setRelation("BBB", "AAA", 80);
    ai.setSystems({ diplomacyManager: diplomacy });
    ai.initializeAgents();
    forceGoal(ai, "AAA", "diplomatic_security");

    const report = ai.runDailyCycle().find(item => item.countryId === "AAA");
    const alliance = diplomacy.alliances.listAlliances({ countryId: "AAA" })[0];

    assert.equal(report.action.action, "defensive_alliance_created");
    assert.deepEqual(alliance.members, ["AAA", "BBB"]);

    ai.destroy();
    diplomacy.destroy();
});
