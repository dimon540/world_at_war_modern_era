import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { ResearchManager } from "../js/technology/research-manager.js";
import { TechnologyTree } from "../js/technology/technology-tree.js";

test("technology tree validates prerequisites and exposes only unlocked research",()=>{
 const tree=new TechnologyTree([{id:"a",name:"A",cost:10},{id:"b",name:"B",cost:20,prerequisites:["a"]}]);
 assert.deepEqual(tree.getAvailable([]).map(x=>x.id),["a"]);
 assert.deepEqual(tree.getAvailable(["a"]).map(x=>x.id),["a","b"]);
 assert.throws(()=>new TechnologyTree([{id:"a",name:"A",cost:1,prerequisites:["missing"]}]),/Unknown prerequisite/);
});

test("country research consumes monthly points and unlocks dependent technology",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA",name:"Alpha"};
 const research=new ResearchManager(state);
 research.setResearchPoints("AAA",100);
 research.startResearch("AAA","infantry_weapons_2000");
 const first=research.processMonthly();
 assert.equal(first.length,1);
 assert.ok(research.getCountryResearch("AAA").completed.includes("infantry_weapons_2000"));
 assert.ok(research.getAvailable("AAA").some(t=>t.id==="body_armor"));
 research.destroy();
});
