export const IDEOLOGIES=Object.freeze({
liberalism:{label:"Liberalism",governmentTypes:["democracy","republic"],modifiers:{research:0.05,trade:0.05,stability:0}},
conservatism:{label:"Conservatism",governmentTypes:["democracy","constitutional_monarchy"],modifiers:{stability:0.03,industry:0.02}},
social_democracy:{label:"Social Democracy",governmentTypes:["democracy","republic"],modifiers:{stability:0.05,industry:0.02}},
socialism:{label:"Socialism",governmentTypes:["one_party_state","democracy"],modifiers:{industry:0.05,stability:0.01}},
communism:{label:"Communism",governmentTypes:["one_party_state"],modifiers:{industry:0.06,military:0.03,trade:-0.02}},
nationalism:{label:"Nationalism",governmentTypes:["authoritarian","democracy"],modifiers:{military:0.05,stability:-0.01}},
fascism:{label:"Fascism",governmentTypes:["authoritarian"],modifiers:{military:0.08,stability:-0.04}},
monarchism:{label:"Monarchism",governmentTypes:["constitutional_monarchy","absolute_monarchy"],modifiers:{stability:0.03}},
islamism:{label:"Islamism",governmentTypes:["theocracy","authoritarian"],modifiers:{stability:0.01}},
green_politics:{label:"Green Politics",governmentTypes:["democracy"],modifiers:{energy:0.05,industry:-0.01}},
non_aligned:{label:"Non-Aligned",governmentTypes:["other","transitional"],modifiers:{diplomacy:0.03}},
other:{label:"Other",governmentTypes:["other","transitional"],modifiers:{}}
});
export function getIdeology(id){const value=IDEOLOGIES[String(id)];return value?{...value,governmentTypes:[...value.governmentTypes],modifiers:{...value.modifiers}}:null;}
export default IDEOLOGIES;