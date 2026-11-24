export const MILITARY_TECHNOLOGIES = Object.freeze([
{id:"infantry_weapons_2000",name:"Modern Infantry Weapons",category:"infantry",era:2000,cost:80},
{id:"body_armor",name:"Personal Protective Equipment",category:"infantry",era:2000,cost:70,prerequisites:["infantry_weapons_2000"]},
{id:"mechanized_infantry",name:"Mechanized Infantry Doctrine",category:"land_doctrine",era:2000,cost:110,prerequisites:["infantry_weapons_2000"]},
{id:"main_battle_tanks",name:"Third-Generation Main Battle Tanks",category:"armor",era:2000,cost:130},
{id:"composite_armor",name:"Advanced Composite Armor",category:"armor",era:2000,cost:100,prerequisites:["main_battle_tanks"]},
{id:"precision_guided_munitions",name:"Precision-Guided Munitions",category:"artillery",era:2000,cost:120},
{id:"integrated_air_defense",name:"Integrated Air Defence",category:"air_defense",era:2000,cost:115},
{id:"fourth_generation_fighters",name:"Fourth-Generation Fighter Aircraft",category:"air",era:2000,cost:150},
{id:"early_uav",name:"Unmanned Aerial Systems",category:"air",era:2000,cost:100},
{id:"diesel_electric_submarines",name:"Modern Diesel-Electric Submarines",category:"naval",era:2000,cost:120},
{id:"guided_missile_frigates",name:"Guided-Missile Surface Combatants",category:"naval",era:2000,cost:135},
{id:"military_satellite_comms",name:"Military Satellite Communications",category:"communications",era:2000,cost:125},
{id:"network_centric_warfare",name:"Network-Centric Warfare",category:"doctrine",era:2000,cost:180,prerequisites:["military_satellite_comms","early_uav"]},
{id:"logistics_automation",name:"Automated Logistics Systems",category:"logistics",era:2000,cost:100},
{id:"professional_army_doctrine",name:"Professional Armed Forces Doctrine",category:"doctrine",era:2000,cost:90}
]);
export default MILITARY_TECHNOLOGIES;