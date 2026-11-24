import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { EventManager } from "../js/events/event-manager.js";
import { WorldEventManager } from "../js/events/world-events.js";
import { CrisisManager } from "../js/events/crisis-manager.js";
import { HistoricalEventManager } from "../js/events/historical-events.js";

test("scheduled events trigger once and apply explicit national effects",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA"};state.politics.governments.AAA={stability:50};
 const events=new EventManager(state);
 events.schedule({id:"event-1",date:"2000-01-02",countryId:"AAA",effects:{stabilityDelta:-5}});
 assert.equal(events.processDaily("2000-01-01").length,0);
 assert.equal(events.processDaily("2000-01-02").length,1);
 assert.equal(state.politics.governments.AAA.stability,45);
 assert.equal(events.processDaily("2000-01-03").length,0);
 events.destroy();
});

test("world event manager uses deterministic injected randomness and cooldown",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA"};
 const manager=new WorldEventManager(state,null,{dailyChance:1,random:()=>0});
 const first=manager.processDaily({year:2000,month:1,day:1});
 const second=manager.processDaily({year:2000,month:1,day:2});
 assert.equal(first.length,1);
 assert.equal(second.length,0);
 manager.destroy();
});

test("crises can escalate and resolve with accurate active counters",()=>{
 const state=createInitialGameState();state.world.countries.AAA={id:"AAA"};
 const crises=new CrisisManager(state);
 crises.start({id:"crisis-1",countryId:"AAA",severity:2});
 crises.escalate("crisis-1",{amount:2});
 assert.equal(crises.list()[0].severity,4);
 crises.resolve("crisis-1");
 assert.equal(state.events.statistics.activeCrises,0);
 crises.destroy();
});

test("verified independence events create historical country records", () => {
 const state=createInitialGameState();
 state.world.countries.YUG={id:"YUG",name:"Federal Republic of Yugoslavia"};
 const history=new HistoricalEventManager(state,null);
 history.load([
  {id:"MNE_INDEPENDENCE",date:"2006-06-03",status:"verified",historical:true,countries:["MNE","YUG"],changes:{
   createdCountry:"MNE",
   createdCountryData:{id:"MNE",name:"Montenegro",officialName:"Republic of Montenegro",capital:"Podgorica",iso2:"ME",iso3:"MNE",region:"Europe"},
   successorCountry:"SRB",
   successorCountryData:{id:"SRB",name:"Serbia",officialName:"Republic of Serbia",capital:"Belgrade",iso2:"RS",iso3:"SRB",region:"Europe"}
  }},
  {id:"KOSOVO_STATUS",date:"2008-02-17",status:"disputed",historical:true,countries:["XKX","SRB"],changes:{
   entity:"XKX",
   entityData:{id:"XKX",name:"Kosovo",capital:"Pristina",iso2:"XK",iso3:"XKX",region:"Europe",status:"disputed_entity"}
  }}
 ]);
 history.processDaily("2006-06-02");
 assert.equal(state.world.countries.MNE,undefined);
 history.processDaily("2006-06-03");
 assert.equal(state.world.countries.MNE.status,"independent");
 assert.equal(state.world.countries.SRB.status,"independent");
 history.processDaily("2008-02-17");
 assert.equal(state.world.countries.XKX.status,"disputed_entity");
 assert.equal(state.world.statistics.totalCountries,4);
 history.destroy();
});
