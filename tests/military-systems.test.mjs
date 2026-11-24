import test from "node:test";
import assert from "node:assert/strict";

import { createInitialGameState } from "../js/core/game-state.js";
import { DivisionManager } from "../js/military/divisions.js";
import { ArmyManager } from "../js/military/army-manager.js";
import { CommanderManager } from "../js/military/commanders.js";
import { MovementManager } from "../js/military/movement.js";
import { CombatManager } from "../js/military/combat.js";

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

    const taskIds = systems.loop.getRegisteredTasks().map(task => task.id);
    assert.ok(taskIds.includes("military.land_movement"));
    assert.ok(taskIds.includes("military.land_combat"));

    game.destroy();
});
