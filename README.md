# satellite

## how to run w/o docker:
this is using wsl

- from backend folder: activate venv `source .venv/bin/activate`
- run uvicorn `uvicorn app.main:app --reload --port 8000`
- cd to app/frontend: `npm install` to install packages, then `npm run dev`

## running with docker:
- cd to infra folder
- run `docker-compose up --build`

## notes
- currently, satellite tiles take a minute to load...working on that
- working to add customizable imagery, such as cloud cover percentages.
