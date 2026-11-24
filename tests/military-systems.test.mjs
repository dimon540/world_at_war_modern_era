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
    assert.equal(typeof systems.armyManager.createArmy, "function");
    assert.equal(typeof systems.commanderManager.createCommander, "function");
    assert.equal(typeof systems.movementManager.advance, "function");
    assert.equal(typeof systems.combatManager.advanceBattles, "function");
    assert.equal(typeof systems.frontlineManager.createFrontline, "function");
    assert.equal(typeof systems.supplyManager.processDaily, "function");
    assert.equal(typeof systems.battlePlanManager.createPlan, "function");

    const taskIds = systems.loop.getRegisteredTasks().map(task => task.id);
    assert.ok(taskIds.includes("military.land_movement"));
    assert.ok(taskIds.includes("military.land_combat"));
    assert.ok(taskIds.includes("military.supply"));

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
