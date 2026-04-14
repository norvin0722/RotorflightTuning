from fastapi import FastAPI
app = FastAPI(title="RF Analyzer AI Sidecar")

@app.get("/health")
async def health():
    return {"status": "ok"}