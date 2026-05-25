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
    texas_precincts_seen: number;
    precincts_assigned_to_city: number;
    cities_total: number;
    cities_with_votes: number;
  };
};
