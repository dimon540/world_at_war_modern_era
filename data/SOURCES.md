
# WORLD AT WAR: MODERN ERA
## Historical Data Sources and Verification Policy

Version: 1.0.0
Scenario reference date: 2000-01-01
Project status: In development

---

## 1. Purpose

This document defines the sources and verification rules for the historical
world simulation.

The initial campaign begins on 1 January 2000. Data must represent the
world as it existed on that date, not the present-day world.

Modern datasets may be used as a technical foundation, but their values
must not automatically be treated as historically accurate for 2000.

## 2. Geographic data

### Natural Earth
Website: https://www.naturalearthdata.com/downloads/

Intended use:
- Global country outlines.
- Coastlines and physical geography.
- Geographic reference layers.
- Initial cartographic foundation.

Important:
Natural Earth is not a complete historical border database.
Modern country boundaries must be checked against historical sources
before being used as borders for January 2000.

### geoBoundaries
Website: https://www.geoboundaries.org/

Repository: https://github.com/wmgeolab/geoBoundaries

Intended use:
- Administrative boundary reference.
- Subnational divisions.
- Comparison and validation of geographic features.

Important:
The dataset primarily represents modern administrative boundaries.
Every source file must be checked for its date, original source and license.
Modern administrative divisions must not automatically be presented
as divisions that existed in 2000.

## 3. Historical countries and state status

### Correlates of War — State System Membership
Website:
https://correlatesofwar.org/data-sets/state-system-membership/

Intended use:
- Historical state membership.
- State entry and exit dates.
- Historical country identification.
- Supporting verification of state status.

Important:
The Correlates of War definition of statehood is a research classification.
It does not include every territory, dependency or disputed entity.
It must not be treated as the only authority for political status.

License:
Review the official terms before downloading, modifying or redistributing
any Correlates of War dataset. Redistribution restrictions apply.

## 4. Population and economy

### World Bank — World Development Indicators
Website:
https://data.worldbank.org/

API documentation:
https://datahelpdesk.worldbank.org/knowledgebase/articles/898581

Intended use:
- Population estimates.
- GDP and GDP per capita.
- Economic growth.
- Trade and development indicators.
- Historical economic comparisons.

Reference year:
2000, where a valid observation is available.

Important:
Record the indicator code, year, unit and source.
Do not silently replace missing historical values with modern values.
Current US dollars and constant-price series must not be mixed.

## 5. Military and international relations

### Correlates of War
Website:
https://correlatesofwar.org/data-sets/

Intended use:
- Historical wars and armed conflicts.
- Militarized interstate disputes.
- Historical state system data.
- International relations research.

Important:
Check the temporal coverage of each individual dataset.
A dataset that ends before 2000 cannot be used as a complete record
of events after its final year.

Review the dataset-specific citation and redistribution terms.

## 6. Historical verification rules

Every important historical record should contain:

- Entity or country identifier.
- Relevant date or date range.
- Source name.
- Source URL or document reference.
- Date when the source was accessed.
- Confidence level.
- Notes about uncertainty or conflicting evidence.

Confidence levels:

- verified: supported by a reliable historical source.
- corroborated: supported by multiple independent sources.
- provisional: plausible but not fully verified.
- disputed: credible sources disagree.
- unknown: no reliable information available.

## 7. Rules for the 1 January 2000 scenario

1. Use historical country names and political status.
2. Do not use present-day borders without historical verification.
3. Distinguish sovereign states from dependent territories.
4. Record disputed territories separately from undisputed ownership.
5. Use historical capitals and administrative divisions.
6. Use economic and population observations from around 2000.
7. Distinguish active military personnel, reserves and paramilitary forces.
8. Do not invent military equipment inventories or force sizes.
9. Preserve the original units and dates of source observations.
10. Document estimates instead of presenting them as confirmed facts.

## 8. Data integrity

Raw source datasets should be kept separate from processed game data.

Recommended workflow:

1. Obtain the original source.
2. Check its license and permitted use.
3. Record its version and access date.
4. Convert it into the project's internal schema.
5. Validate identifiers and geographic references.
6. Check historical accuracy for 1 January 2000.
7. Record transformations and unresolved issues.
8. Only then include it in the playable scenario.

## 9. Known limitations

The initial country catalogue is a working dataset and requires
historical review.

Modern geographic datasets do not by themselves provide a reliable
world map for 1 January 2000.

Historical military inventories, economic indicators and territorial
ownership require separate verification.

No dataset should be described as complete until its coverage
and accuracy have been checked.

## 10. Project data principle

Historical accuracy takes priority over artificial completeness.

When reliable data is unavailable, the project must identify the gap
rather than silently inventing a historical fact.
