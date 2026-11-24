import { CountryPolitics } from "../countries/country-politics.js";
export class GovernmentManager extends CountryPolitics {
 getGovernmentType(countryId){return this.getGovernment(countryId)?.type??null;}
 setHeadOfState(countryId,name){const current=this.getGovernment(countryId)??{};return this.setGovernment(countryId,{...current,headOfState:String(name??"").trim()||null},{reason:"head_of_state_changed"});}
 setHeadOfGovernment(countryId,name){const current=this.getGovernment(countryId)??{};return this.setGovernment(countryId,{...current,headOfGovernment:String(name??"").trim()||null},{reason:"head_of_government_changed"});}
}
export default GovernmentManager;