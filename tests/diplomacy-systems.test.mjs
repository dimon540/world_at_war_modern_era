import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { DiplomacyManager } from "../js/diplomacy/diplomacy-manager.js";

function stateWithCountries() {
 const state=createInitialGameState();
 state.world.countries.AAA={id:"AAA",name:"Alpha"};
 state.world.countries.BBB={id:"BBB",name:"Bravo"};
 state.world.countries.CCC={id:"CCC",name:"Charlie"};
 return state;
}

test("alliances enforce membership and update world counters",()=>{
 const state=stateWithCountries(),d=new DiplomacyManager(state);
 const alliance=d.alliances.createAlliance({id:"alliance-1",name:"Regional Pact",members:["AAA","BBB"]});
 assert.deepEqual(alliance.members,["AAA","BBB"]);
 assert.equal(state.diplomacy.statistics.activeAlliances,1);
 assert.equal(d.alliances.areAllied("AAA","BBB"),true);
 d.alliances.addMember("alliance-1","CCC");
 assert.equal(d.alliances.getAlliance("alliance-1").members.length,3);
 d.alliances.dissolveAlliance("alliance-1",{reason:"test"});
 assert.equal(state.diplomacy.statistics.activeAlliances,0);
 d.destroy();
});

test("war declarations, participants and peace acceptance close the war",()=>{
 const state=stateWithCountries(),d=new DiplomacyManager(state);
 d.wars.declareWar({id:"war-1",attackerId:"AAA",defenderId:"BBB",date:"2000-01-01"});
 d.wars.joinWar("war-1","CCC","defender",{date:"2000-01-02"});
 assert.equal(d.wars.listWars({status:"active"}).length,1);
 d.peace.propose({id:"peace-1",warId:"war-1",proposerId:"AAA",recipientId:"BBB",terms:[{type:"ceasefire"}]});
 d.peace.accept("peace-1",{date:"2000-02-01"});
 assert.equal(d.wars.getWar("war-1").status,"ended");
 assert.equal(state.diplomacy.statistics.activeWars,0);
 d.destroy();
});

test("sanctions can be imposed, queried and lifted",()=>{
 const state=stateWithCountries(),d=new DiplomacyManager(state);
 d.sanctions.impose({id:"sanction-1",issuerId:"AAA",targetId:"BBB",scope:"trade",date:"2000-01-01"});
 assert.equal(d.sanctions.isTargeted("BBB").length,1);
 assert.equal(state.diplomacy.statistics.activeSanctions,1);
 d.sanctions.lift("sanction-1",{date:"2000-02-01"});
 assert.equal(state.diplomacy.statistics.activeSanctions,0);
 d.destroy();
});

test("relations are available through the unified diplomacy facade",()=>{
 const state=stateWithCountries(),d=new DiplomacyManager(state);
 d.relations.setRelation("AAA","BBB",65,{reason:"test"});
 assert.equal(d.relations.getValue("AAA","BBB"),65);
 assert.equal(d.getSnapshot().relations.friendlyRelations,1);
 d.destroy();
});
