export type CityProperties = {
  city_name: string;
  geoid: string;
  geoid_fq: string;
  pop_est_2020: number;
  dem_votes: number;
  rep_votes: number;
  total_votes: number;
  total_major_party_votes: number;
  dem_share: number | null;
  rep_share: number | null;
  margin: number | null;
  winner: "Democratic" | "Republican" | "Needs Review" | "No matched precinct";
  precincts_assigned: number;
  needs_review: boolean;
  aggregation_method: string;
  source_label: string;
};

export type CityFeature = GeoJSON.Feature<GeoJSON.Geometry, CityProperties>;

export type DataStatus = "Mapped" | "Needs Review" | "Dallas OpenData";

export type ZipProperties = {
  zcta: string;
  city_names: string[];
  search_label: string;
  dem_votes: number;
  rep_votes: number;
  total_votes: number;
  total_major_party_votes: number;
  dem_share: number | null;
  rep_share: number | null;
  margin: number | null;
  winner: "Democratic" | "Republican" | "Needs Review" | "No matched precinct";
  precincts_assigned: number;
  population: number | null;
  median_age: number | null;
  median_household_income: number | null;
  white_non_hispanic_share: number | null;
  black_non_hispanic_share: number | null;
  asian_non_hispanic_share: number | null;
  hispanic_share: number | null;
  housing_units: number | null;
  dominant_housing_era: string | null;
  dominant_housing_era_share: number | null;
  crime_year: number;
  crime_total: number | null;
  robbery_count: number | null;
  homicide_count: number | null;
  aggravated_assault_count: number | null;
  shooting_count: number | null;
  violent_crime_rate_per_100k: number | null;
  robbery_rate_per_100k: number | null;
  homicide_rate_per_100k: number | null;
  shooting_rate_per_100k: number | null;
  politics_status: DataStatus;
  safety_status: DataStatus;
  demographics_status: DataStatus;
  needs_review: boolean;
  source_label: string;
};

export type ZipFeature = GeoJSON.Feature<GeoJSON.Geometry, ZipProperties>;

export type SourcesDocument = {
  generated_at: string;
  primary_support_metric: string;
  caveat: string;
  sources: Array<{
    label: string;
    url: string;
    note?: string;
  }>;
};

export type MethodologyDocument = {
  title: string;
  geography: string;
  election: string;
  aggregation_method: string;
  limitations: string[];
  stats: {
    texas_precincts_seen?: number;
    precincts_assigned_to_city?: number;
    cities_total?: number;
    cities_with_votes?: number;
    zctas_total?: number;
    zctas_with_votes?: number;
    zctas_with_demographics?: number;
    zctas_with_safety?: number;
    precincts_assigned_to_zcta?: number;
  };
};
