from fastapi import FastAPI

app = FastAPI(title="ForensicLens Backend")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "forensiclens-backend"
    }

