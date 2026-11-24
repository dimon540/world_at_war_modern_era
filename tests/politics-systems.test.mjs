import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { PoliticsManager } from "../js/politics/politics-manager.js";

test("politics manager handles government, elections and stability",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA",name:"Alpha"};
 const politics=new PoliticsManager(state);
 politics.governments.setGovernment("AAA",{type:"democracy",ideology:"liberalism",stability:50});
 politics.governments.addParty("AAA",{id:"party-a",name:"Reform Party",ideology:"liberalism",support:60});
 politics.governments.addParty("AAA",{id:"party-b",name:"Workers Party",ideology:"socialism",support:40});
 politics.elections.schedule("AAA",{id:"election-2000",date:"2000-01-02"});
 const resolved=politics.processDaily({year:2000,month:1,day:2});
 assert.equal(resolved.length,1);
 assert.equal(politics.governments.getGovernment("AAA").rulingPartyId,"party-a");
 politics.stability.processMonthly({AAA:{war:-2}});
 assert.equal(politics.governments.getGovernment("AAA").stability,48);
 politics.destroy();
});

test("national focus and decisions require valid prerequisites and costs",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA",name:"Alpha"};
 const politics=new PoliticsManager(state);
 const first=politics.nationalFocus.start("AAA","industrial_recovery");
 assert.equal(first.id,"industrial_recovery");
 const done=politics.nationalFocus.advance("AAA",70);
 assert.equal(done.completed,true);
 assert.ok(politics.nationalFocus.getAvailable("AAA").some(x=>x.id==="education_investment"));
 const decision=politics.decisions.execute("AAA","anti_corruption_drive",{date:"2000-01-01"});
 assert.equal(decision.decisionId,"anti_corruption_drive");
 politics.destroy();
});
