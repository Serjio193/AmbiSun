import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path

cities_file = Path(sys.argv[1])
country_file = Path(sys.argv[2])
out_root = Path(sys.argv[3])

cities_dir = out_root / "cities"

out_root.mkdir(parents=True, exist_ok=True)

if cities_dir.exists():
    shutil.rmtree(cities_dir)

cities_dir.mkdir(parents=True, exist_ok=True)

regions = {
    "Europe": [],
    "Asia": [],
    "Africa": [],
    "North America": [],
    "South America": [],
    "Oceania": []
}

continent_map = {
    "EU": "Europe",
    "AS": "Asia",
    "AF": "Africa",
    "NA": "North America",
    "SA": "South America",
    "OC": "Oceania"
}

# ------------------------------------------------------------
# Countries
#
# GeoNames countryInfo columns:
# 0 ISO
# 4 Country
# 8 Continent
# ------------------------------------------------------------

with country_file.open("r", encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")

        if not line or line.startswith("#"):
            continue

        cols = line.split("\t")

        if len(cols) < 9:
            continue

        code = cols[0].strip().upper()
        name = cols[4].strip()
        continent = cols[8].strip().upper()

        region = continent_map.get(continent)

        if len(code) != 2 or not name or not region:
            continue

        regions[region].append({
            "code": code,
            "name": name
        })

for region in regions:
    regions[region].sort(
        key=lambda x: x["name"].casefold()
    )

(out_root / "countries.json").write_text(
    json.dumps(
        regions,
        ensure_ascii=False,
        separators=(",", ":")
    ),
    encoding="utf-8"
)

# ------------------------------------------------------------
# Cities
#
# GeoNames geoname columns:
# 1  name
# 4  latitude
# 5  longitude
# 8  country code
# 14 population
# 17 timezone
#
# Compact output:
# n = name
# a = latitude
# o = longitude
# t = timezone
# p = population
# ------------------------------------------------------------

by_country = defaultdict(list)

with cities_file.open("r", encoding="utf-8") as f:
    for line in f:
        cols = line.rstrip("\n").split("\t")

        if len(cols) < 19:
            continue

        name = cols[1].strip()
        country = cols[8].strip().upper()
        timezone = cols[17].strip()

        if not name or len(country) != 2 or not timezone:
            continue

        try:
            lat = round(float(cols[4]), 5)
            lon = round(float(cols[5]), 5)
        except ValueError:
            continue

        try:
            population = int(cols[14] or "0")
        except ValueError:
            population = 0

        by_country[country].append({
            "n": name,
            "a": lat,
            "o": lon,
            "t": timezone,
            "p": population
        })

total = 0
counts = {}

for country, rows in by_country.items():

    rows.sort(
        key=lambda c: (
            -(c.get("p") or 0),
            c["n"].casefold()
        )
    )

    seen = set()
    clean = []

    for city in rows:
        key = city["n"].casefold()

        if key in seen:
            continue

        seen.add(key)
        clean.append(city)

    counts[country] = len(clean)
    total += len(clean)

    (cities_dir / f"{country}.json").write_text(
        json.dumps(
            clean,
            ensure_ascii=False,
            separators=(",", ":")
        ),
        encoding="utf-8"
    )

manifest = {
    "source": "GeoNames cities15000",
    "license": "CC BY 4.0",
    "countries": sum(len(v) for v in regions.values()),
    "countriesWithCities": len(by_country),
    "cities": total,
    "RU": counts.get("RU", 0),
    "EE": counts.get("EE", 0),
    "UA": counts.get("UA", 0)
}

(out_root / "manifest.json").write_text(
    json.dumps(
        manifest,
        ensure_ascii=False,
        indent=2
    ),
    encoding="utf-8"
)

(out_root / "README.txt").write_text(
    "AmbiSun offline location database\n"
    "Derived from GeoNames cities15000 and countryInfo.\n"
    "License: Creative Commons Attribution 4.0 (CC BY 4.0).\n"
    "Contains country names plus city name, latitude, longitude, "
    "population and IANA timezone.\n",
    encoding="utf-8"
)

print("===================================")
print("GEONAMES DATABASE GENERATED")
print("===================================")
print("Countries:", manifest["countries"])
print("Countries with cities:", manifest["countriesWithCities"])
print("Total cities:", manifest["cities"])
print("Russia:", manifest["RU"])
print("Estonia:", manifest["EE"])
print("Ukraine:", manifest["UA"])