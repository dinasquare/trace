export type LeakCategory =
  | "location" | "occupation" | "age" | "gender" | "family"
  | "health" | "interests" | "education" | "relationship"
  | "life_event" | "writing_style" | "linkable_phrase";

export type Confidence   = "low" | "medium" | "high";
export type Distinctiveness = "common" | "somewhat_distinctive" | "highly_distinctive";
export type RiskBand     = "low" | "moderate" | "high" | "severe";

export interface Rewrite {
  original:   string;
  suggestion: string;
  delta:      string;
}

export interface Finding {
  category:      LeakCategory;
  inference:     string;
  evidence_span: string;
  reasoning:     string;
  confidence:    Confidence;
  distinctiveness: Distinctiveness;
  rewrite?:      Rewrite | null;
}

export interface RiskScore {
  joint_fraction:      number;
  matching_population: number;
  headline:            string;
  band:                RiskBand;
  explanation:         string;
}

export interface LeakReport {
  findings:     Finding[];
  overall_risk: Confidence;
  summary:      string;
  risk:         RiskScore;
}

export type RwState = "idle" | "loading" | "ready" | "accepted" | "dismissed";

export interface Token {
  kind: "plain" | "highlight" | "rewritten";
  text?: string;
  original?: string;
  replacement?: string;
  cat?: LeakCategory;
  idx?: number;
}