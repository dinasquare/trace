import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from extractor import analyze, rewrite_suggestion
from schema import Finding, LeakReport

app = FastAPI(title="Trace API")

# In production set ALLOWED_ORIGIN to your deployed frontend URL.
# Locally it defaults to * so dev works without config.
allowed_origin = os.getenv("ALLOWED_ORIGIN", "*")
origins = [allowed_origin] if allowed_origin != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


class RewriteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)
    finding: Finding


class RewriteResponse(BaseModel):
    original: str
    suggestion: str
    delta: str


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=LeakReport)
def analyze_endpoint(req: AnalyzeRequest):
    try:
        return analyze(req.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@app.post("/rewrite", response_model=RewriteResponse)
def rewrite_endpoint(req: RewriteRequest):
    try:
        result = rewrite_suggestion(req.text, req.finding)
        return RewriteResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rewrite failed: {e}")