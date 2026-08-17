# Courtside Badminton Scheduler

Static badminton scheduler UI with a Spring Boot backend for secure AI/LLM calls.

## Run Locally

Set your API key in the shell before starting the app:

```powershell
$env:GEMINI_API_KEY="your_gemini_api_key_here"
mvn spring-boot:run
```

Open `http://localhost:8080`.

## AI Endpoint

`POST /api/ai/insights`

```json
{
  "question": "Summarize fairness and suggest one improvement.",
  "schedulerState": {
    "players": [],
    "matches": [],
    "scores": {}
  }
}
```

The API key stays on the Spring Boot server. Do not put it in frontend JavaScript or GitHub Pages.

## Configuration

Environment variables:

- `GEMINI_API_KEY`: required for AI calls
- `LLM_MODEL`: defaults to `gemini-3.5-flash`
- `LLM_BASE_URL`: defaults to `https://generativelanguage.googleapis.com/v1beta`
- `APP_CORS_ALLOWED_ORIGINS`: comma-separated allowed frontend origins
