import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { WorldAIManager } from "../js/ai/world-ai-manager.js";
import { ResearchManager } from "../js/technology/research-manager.js";
import { EconomyManager } from "../js/economy/economy-manager.js";
import { DiplomacyManager } from "../js/diplomacy/diplomacy-manager.js";
import { DivisionManager } from "../js/military/divisions.js";
import { ArmyManager } from "../js/military/army-manager.js";
import { PoliticsManager } from "../js/politics/politics-manager.js";

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
    economy.factories.create({ id: "civilian-works", countryId: "AAA", type: "civilian", level: 2 });
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
    assert.equal(report.action.action, "industrial_expansion_started");
    assert.equal(report.action.constructionStarted, true);
    assert.equal(economy.construction.list({ countryId: "AAA", status: "active" }).length, 1);

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

test("AI military priority organizes existing divisions into an army", () => {
    const state = makeState();
    const ai = new WorldAIManager(state);
    const divisions = new DivisionManager(state);
    const armies = new ArmyManager(state);
    const division = divisions.createDivision("AAA", "1st Infantry", { infantry: 1 }).division;
    ai.setSystems({ divisionManager: divisions, armyManager: armies });
    ai.initializeAgents();
    forceGoal(ai, "AAA", "military_modernization");

    const report = ai.runDailyCycle()[0];

    assert.equal(report.action.action, "army_formation_created");
    assert.equal(state.military.divisions[division.id].armyId, report.action.armyId);
    assert.equal(armies.getArmy(report.action.armyId).divisionIds.length, 1);

    ai.destroy();
    armies.destroy();
    divisions.destroy();
});

test("AI domestic stability priority sets a modifier used by monthly politics", () => {
    const state = makeState();
    const ai = new WorldAIManager(state);
    const politics = new PoliticsManager(state);
    politics.governments.setGovernment("AAA", { type: "republic", stability: 30 });
    ai.setSystems({ politicsManager: politics });
    ai.initializeAgents();
    forceGoal(ai, "AAA", "domestic_stability");

    const report = ai.runDailyCycle()[0];

    assert.equal(report.action.action, "stability_policy_set");
    assert.equal(state.politics.stabilityModifiers.AAA.government, 0.75);
    const changes = politics.processMonthly();
    assert.equal(changes[0].countryId, "AAA");
    assert.equal(politics.governments.getGovernment("AAA").stability, 30.75);

    ai.destroy();
    politics.destroy();
});
