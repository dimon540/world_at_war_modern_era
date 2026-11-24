import { CountryPolitics } from "../countries/country-politics.js";
const dateKey=value=>{if(typeof value==="string")return value;return [value.year,String(value.month).padStart(2,"0"),String(value.day).padStart(2,"0")].join("-");};
export class ElectionManager {
 constructor(state,eventBus){this.politics=new CountryPolitics(state,eventBus);this.state=state;this.destroyed=false;}
 schedule(countryId,election){if(this.destroyed)throw new Error("ElectionManager has been destroyed.");return this.politics.scheduleElection(countryId,election);}
 resolve(countryId,electionId,partyVotes){if(this.destroyed)throw new Error("ElectionManager has been destroyed.");return this.politics.resolveElection(countryId,electionId,{partyVotes});}
 processDue(date){if(this.destroyed)throw new Error("ElectionManager has been destroyed.");const today=dateKey(date),resolved=[];for(const [countryId,elections] of Object.entries(this.state.politics.elections??{})){for(const election of Object.values(elections??{})){if(election.status!=="scheduled"||election.date>today)continue;const parties=this.politics.getParties(countryId);const votes=Object.fromEntries(parties.map(p=>[p.id,p.support]).filter(([,n])=>Number.isFinite(n)&&n>0));if(!Object.keys(votes).length)continue;const result=this.politics.resolveElection(countryId,election.id,{partyVotes:votes});if(result)resolved.push({countryId,electionId:election.id,result});}}return resolved;}
 destroy(){if(this.destroyed)return;this.politics.destroy();this.state=null;this.destroyed=true;}
}
export default ElectionManager;