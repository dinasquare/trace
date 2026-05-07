from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class LeakCategory(str, Enum):
    LOCATION = "location"
    AGE = "age"
    GENDER = "gender"
    OCCUPATION = "occupation"
    EDUCATION = "education"
    RELATIONSHIP = "relationship"
    FAMILY = "family"
    HEALTH = "health"
    INTERESTS = "interests"
    LIFE_EVENT = "life_event"
    WRITING_STYLE = "writing_style"
    LINKABLE_PHRASE = "linkable_phrase"


class Confidence(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Distinctiveness(str, Enum):
    COMMON = "common"
    SOMEWHAT_DISTINCTIVE = "somewhat_distinctive"
    HIGHLY_DISTINCTIVE = "highly_distinctive"


class Rewrite(BaseModel):
    original: str
    suggestion: str
    delta: str


class Finding(BaseModel):
    category: LeakCategory = Field(description="What kind of personal info leaked")
    inference: str = Field(description="What the model inferred, in plain language")
    evidence_span: str = Field(
        description="The exact substring from the user's text that revealed this. Must appear verbatim in the input."
    )
    reasoning: str = Field(description="One sentence explaining why this phrase reveals this info")
    confidence: Confidence
    distinctiveness: Distinctiveness = Field(
        description="How rare/identifying this attribute is in the general population"
    )
    rewrite: Optional[Rewrite] = Field(
        default=None,
        description="Minimum-edit rewrite suggestion, populated by /rewrite endpoint",
    )


class RiskScore(BaseModel):
    joint_fraction: float
    matching_population: int
    headline: str
    band: str
    explanation: str


class LeakReport(BaseModel):
    findings: List[Finding]
    overall_risk: Confidence = Field(description="Overall identifiability risk from this post")
    summary: str = Field(description="One or two sentences summarizing the biggest concerns")
    risk: RiskScore = Field(description="Joint identifiability score computed from findings")
