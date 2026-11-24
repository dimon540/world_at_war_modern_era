import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { createInitialGameState } from "../js/core/game-state.js";
import { DivisionManager } from "../js/military/divisions.js";
import { ArmyManager } from "../js/military/army-manager.js";
import { CommanderManager } from "../js/military/commanders.js";
import { MovementManager } from "../js/military/movement.js";
import { CombatManager } from "../js/military/combat.js";
import { FrontlineManager } from "../js/military/frontlines.js";
import { SupplyManager } from "../js/military/supply.js";
import { WorldAIManager } from "../js/ai/world-ai-manager.js";
import { GDPManager } from "../js/economy/gdp.js";
import { BudgetManager } from "../js/economy/budget.js";
import { EconomyManager } from "../js/economy/economy-manager.js";
import { BattlePlanManager } from "../js/military/battle-plans.js";

function makeState() {
    const state = createInitialGameState();
    state.world.countries.AAA = { id: "AAA", name: "Alpha" };
    state.world.countries.BBB = { id: "BBB", name: "Bravo" };
    state.world.provinces.P1 = { id: "P1" };
    state.world.provinces.P2 = { id: "P2" };
    state.world.ownership.provinceOwners.P1 = "AAA";
    state.world.ownership.provinceOwners.P2 = "AAA";
    return state;
}

test("army and commander assignments remain synchronized", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const armies = new ArmyManager(state);
    const commanders = new CommanderManager(state);
    const created = divisions.createDivision("AAA", "1st Infantry", { infantry: 1 }, { provinceId: "P1" });
    const army = armies.createArmy("AAA", "1st Army").army;
    const commander = commanders.createCommander("AAA", "General Example").commander;

    armies.assignDivision(army.id, created.division.id);
    commanders.assignToArmy(commander.id, army.id);

    assert.equal(state.military.divisions[created.division.id].armyId, army.id);
    assert.equal(state.military.armies[army.id].commanderId, commander.id);
    assert.equal(commanders.getCommander(commander.id).assignment.id, army.id);

    armies.disbandArmy(army.id, { keepDivisions: true });
    assert.equal(state.military.divisions[created.division.id].armyId, null);
    assert.equal(state.military.divisions[created.division.id].status, "active");
});

test("movement orders advance divisions along their explicit route", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const movement = new MovementManager(state, divisions);
    const created = divisions.createDivision("AAA", "1st Infantry", { infantry: 1 }, { provinceId: "P1" });

    movement.issueMoveOrder(created.division.id, ["P1", "P2"]);
    const report = movement.advance(24);

    assert.equal(report.length, 1);
    assert.equal(report[0].status, "completed");
    assert.equal(state.military.divisions[created.division.id].location.provinceId, "P2");
    assert.equal(movement.getMoveOrder(created.division.id), null);
});

test("combat applies losses and finishes when a formation breaks", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const combat = new CombatManager(state, divisions);
    const attacker = divisions.createDivision("AAA", "Attacking Infantry", { infantry: 1 }, { provinceId: "P1" });
    const defender = divisions.createDivision("BBB", "Defending Infantry", { infantry: 1 }, { provinceId: "P1" });

    const started = combat.startBattle({
        provinceId: "P1",
        attackerDivisionIds: [attacker.division.id],
        defenderDivisionIds: [defender.division.id]
    });
    const before = state.military.divisions[attacker.division.id].strength;
    combat.advanceBattles(1);

    assert.equal(started.battle.status, "active");
    assert.ok(state.military.divisions[attacker.division.id].strength < before);
    assert.equal(combat.getActiveBattles().length, 1);
    assert.equal(state.military.statistics.activeBattles, 1);
});

import { createGame } from "../js/core/game.js";

test("game engine wires military systems and hourly simulation tasks", () => {
    const game = createGame({ autoLoadWorld: false });
    const systems = game.getSystems();

    assert.equal(typeof systems.divisionManager.createDivision, "function");
    assert.equal(typeof systems.equipmentManager.addStock, "function");
    assert.equal(typeof systems.equipmentProductionManager.createLine, "function");
    assert.equal(typeof systems.armyManager.createArmy, "function");
    assert.equal(typeof systems.commanderManager.createCommander, "function");
    assert.equal(typeof systems.movementManager.advance, "function");
    assert.equal(typeof systems.combatManager.advanceBattles, "function");
    assert.equal(typeof systems.frontlineManager.createFrontline, "function");
    assert.equal(typeof systems.supplyManager.processDaily, "function");
    assert.equal(typeof systems.battlePlanManager.createPlan, "function");
    assert.equal(typeof systems.worldAIManager.runDailyCycle, "function");
    assert.equal(typeof systems.economyManager.processMonthly, "function");

    const taskIds = systems.loop.getRegisteredTasks().map(task => task.id);
    assert.ok(taskIds.includes("military.land_movement"));
    assert.ok(taskIds.includes("military.land_combat"));
    assert.ok(taskIds.includes("military.supply"));
    assert.ok(taskIds.includes("ai.country_daily"));
    assert.ok(taskIds.includes("ai.country_weekly"));
    assert.ok(taskIds.includes("ai.country_monthly"));
    assert.ok(taskIds.includes("economy.monthly"));

    game.destroy();
});

test("frontlines track assigned armies and release them when disbanded", () => {
    const state = makeState();
    const armies = new ArmyManager(state);
    const frontlines = new FrontlineManager(state);
    const army = armies.createArmy("AAA", "Border Army").army;
    const front = frontlines.createFrontline({
        countryId: "AAA",
        enemyCountryId: "BBB",
        name: "Northern Front",
        provinceIds: ["P1"],
        armyIds: [army.id]
    }).frontline;

    assert.deepEqual(front.armyIds, [army.id]);
    assert.equal(state.military.armies[army.id].frontlineId, front.id);
    assert.equal(frontlines.getFrontlineStrength(front.id).armies, 1);

    armies.disbandArmy(army.id);
    assert.deepEqual(state.military.fronts[front.id].armyIds, []);
    assert.equal(state.military.armies[army.id].frontlineId, undefined);
});

test("supply networks allocate stockpiles to assigned divisions", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const supply = new SupplyManager(state, divisions);
    const division = divisions.createDivision("AAA", "Supplied Infantry", { infantry: 1 }, { provinceId: "P1" }).division;
    const network = supply.createNetwork({
        countryId: "AAA",
        name: "Capital Supply Line",
        provinceIds: ["P1", "P2"],
        stockpiles: { supplies: 100, fuel: 100 },
        dailyThroughput: 100
    }).network;

    supply.assignDivision(network.id, division.id);
    const report = supply.processDaily();

    assert.equal(report.length, 1);
    assert.equal(report[0].supplyLevel, 1);
    assert.equal(state.military.divisions[division.id].supplyLevel, 1);
    assert.ok(state.military.supplyNetworks[network.id].stockpiles.supplies < 100);
});

test("battle plans issue explicit routes to divisions in assigned armies", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const armies = new ArmyManager(state);
    const fronts = new FrontlineManager(state);
    const movement = new MovementManager(state, divisions);
    const plans = new BattlePlanManager(state, armies, fronts, movement);
    const division = divisions.createDivision("AAA", "Plan Infantry", { infantry: 1 }, { provinceId: "P1" }).division;
    const army = armies.createArmy("AAA", "Northern Army").army;
    armies.assignDivision(army.id, division.id);
    const front = fronts.createFrontline({
        countryId: "AAA", enemyCountryId: "BBB", name: "Northern Front",
        provinceIds: ["P1", "P2"], armyIds: [army.id]
    }).frontline;
    const plan = plans.createPlan({
        countryId: "AAA", name: "Advance to P2",
        frontlineId: front.id, armyIds: [army.id], objectiveProvinceIds: ["P2"]
    }).plan;

    const issued = plans.issueDivisionOrder(plan.id, division.id, ["P1", "P2"]);
    assert.equal(issued.success, true);
    assert.equal(plans.getPlan(plan.id).status, "active");
    assert.equal(plans.getProgress(plan.id).activeOrders, 1);

    movement.advance(24);
    assert.equal(plans.getProgress(plan.id).completedOrders, 1);
});

test("battle plan cancellation clears active division movement", () => {
    const state = makeState();
    const divisions = new DivisionManager(state);
    const armies = new ArmyManager(state);
    const fronts = new FrontlineManager(state);
    const movement = new MovementManager(state, divisions);
    const plans = new BattlePlanManager(state, armies, fronts, movement);
    const division = divisions.createDivision("AAA", "Order Infantry", { infantry: 1 }, { provinceId: "P1" }).division;
    const army = armies.createArmy("AAA", "Order Army").army;
    armies.assignDivision(army.id, division.id);
    const plan = plans.createPlan({
        countryId: "AAA", name: "Hold and advance", armyIds: [army.id], objectiveProvinceIds: ["P2"]
    }).plan;

    plans.issueDivisionOrder(plan.id, division.id, ["P1", "P2"]);
    assert.ok(movement.getMoveOrder(division.id));
    plans.setStatus(plan.id, "cancelled");

    assert.equal(movement.getMoveOrder(division.id), null);
    assert.equal(plans.getPlan(plan.id).status, "cancelled");
    assert.equal(plans.getProgress(plan.id).orders[0].status, "cancelled");
});

test("independent AI agents make strategic decisions for every country", () => {
    const state = makeState();
    const ai = new WorldAIManager(state);
    const initialized = ai.initializeAgents();

    assert.equal(initialized.totalCountries, 2);
    assert.equal(ai.getSnapshot().activeAgents, 2);
    assert.notDeepEqual(
        ai.getAgent("AAA").personality,
        ai.getAgent("BBB").personality
    );

    const daily = ai.runDailyCycle();
    assert.equal(daily.length, 2);
    assert.equal(ai.getSnapshot().totalDecisions, 2);
    assert.ok(ai.getAgent("AAA").currentPlan.length > 0);

    ai.setCountryAI("BBB", false);
    assert.equal(ai.runDailyCycle().length, 1);
    assert.equal(ai.runWeeklyReview().length, 1);
    assert.equal(ai.runMonthlyReview().length, 1);
    assert.throws(() => ai.setPriority("AAA", "unknown_goal", 0.5), /Unknown strategic goal/);
});

test("real scenario dataset creates an independent AI agent for every country", async () => {
    const dataset = JSON.parse(await readFile(
        new URL("../data/countries/countries.json", import.meta.url),
        "utf8"
    ));
    const state = createInitialGameState();
    for (const country of dataset.countries) state.world.countries[country.id] = country;

    const ai = new WorldAIManager(state);
    const initialized = ai.initializeAgents();
    const daily = ai.runDailyCycle();

    assert.equal(initialized.totalCountries, dataset.countries.length);
    assert.equal(ai.getSnapshot().totalAgents, dataset.countries.length);
    assert.equal(ai.getSnapshot().activeAgents, dataset.countries.length);
    assert.equal(daily.length, dataset.countries.length);
    assert.equal(ai.getSnapshot().totalDecisions, dataset.countries.length);
});

test("GDP and budget systems preserve sourced baselines and calculate changes", () => {
    const state = makeState();
    const gdp = new GDPManager(state);
    const budget = new BudgetManager(state);

    gdp.initializeCountry("AAA", {
        nominalGDP: 1000,
        realGDP: 900,
        population: 100,
        annualGrowthRate: 0.02,
        currency: "USD",
        source: "test_fixture",
        asOf: "2000-01-01"
    });
    const grown = gdp.applyGrowth("AAA", 0.1, { days: 365 });
    assert.equal(grown.nominalGDP, 1100);
    assert.equal(gdp.getWorldStatistics().countriesWithGDPData, 1);
    assert.equal(gdp.getWorldStatistics().weightedGDPPerCapita, 11);

    budget.initializeCountry("AAA", {
        treasury: 100,
        monthlyRevenue: 100,
        debt: 20,
        allocations: { civilian: 0.6, military: 0.6 }
    });
    const monthly = budget.processMonthly("AAA");
    assert.equal(monthly.totalSpending, 120);
    assert.equal(monthly.deficit, 20);
    assert.equal(monthly.treasury, 80);
    assert.equal(monthly.debt, 40);
    assert.throws(() => budget.setAllocations("AAA", { civilian: 1.6 }), /150%/);
});

test("monthly economy manager updates initialized country accounts", () => {
    const state = makeState();
    const economy = new EconomyManager(state);
    economy.initializeCountry("AAA", {
        gdp: { nominalGDP: 1000, realGDP: 900, population: 100, annualGrowthRate: 0.12, source: "test_fixture" },
        budget: { treasury: 500, monthlyRevenue: 100, allocations: { civilian: 0.4, military: 0.3, research: 0.1 } }
    });

    const report = economy.processMonthly();
    assert.equal(report.countriesWithGDP, 1);
    assert.equal(report.countriesWithBudgets, 1);
    assert.ok(report.gdp.nominalGDP > 1000);
    assert.equal(economy.getCountryOverview("AAA").budget.monthlySpending.civilian, 40);
    assert.equal(economy.getWorldStatistics().gdp.countriesWithGDPData, 1);
});

test("game engine recruits divisions only when required equipment is available", () => {
    const game = createGame({ autoLoadWorld: false });
    game.state.world.countries.AAA = { id: "AAA", name: "Alpha" };
    const equipment = game.equipmentManager;
    equipment.addStock("AAA", "small_arms", 1);
    equipment.addStock("AAA", "support_equipment", 1);

    const created = game.divisionManager.createDivision(
        "AAA",
        "Equipped Infantry",
        { infantry: 1 },
        { requireEquipment: true }
    );

    assert.equal(created.success, true);
    assert.equal(equipment.getStock("AAA", "small_arms"), 0);
    assert.equal(equipment.getStock("AAA", "support_equipment"), 0);

    const rejected = game.divisionManager.createDivision(
        "AAA",
        "Unequipped Infantry",
        { infantry: 1 },
        { requireEquipment: true }
    );
    assert.equal(rejected.success, false);
    assert.equal(rejected.reason, "insufficient_equipment");

    game.destroy();
});

test("equipment production consumes industrial resources and updates national stockpiles", () => {
    const game = createGame({ autoLoadWorld: false });
    game.state.world.countries.AAA = { id: "AAA", name: "Alpha" };
    const factory = game.economyManager.factories.create({
        id: "AAA-military-works",
        countryId: "AAA",
        type: "military",
        level: 2
    });
    game.economyManager.resources.setStockpile("AAA", "steel", 20);
    game.equipmentProductionManager.createLine({
        id: "AAA-small-arms",
        countryId: "AAA",
        factoryId: factory.id,
        equipmentId: "small_arms",
        resourceInputs: { steel: 2 },
        unitsPerFactory: 3
    });

    const report = game.equipmentProductionManager.processMonthly()[0];

    assert.equal(report.success, true);
    assert.equal(report.produced, 6);
    assert.equal(game.equipmentManager.getStock("AAA", "small_arms"), 6);
    assert.equal(game.economyManager.resources.getStockpiles("AAA").steel, 8);

    game.destroy();
});
