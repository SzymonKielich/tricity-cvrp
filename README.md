# tricity-cvrp

Delivery route optimization for the Hedyla challenge in Viladecans. The app uses Next.js, FastAPI and OR-Tools to plan pickup and delivery routes with time windows and vehicle capacity limits.

## Run locally

Start Docker, then run:

```sh
docker compose up -d --build --wait
```

Open [the app](http://localhost:3000), [route explorer](http://localhost:3000/routes), or [emissions by distance](http://localhost:3000/emissions). The app imports a saved scenario on first startup. Set `SHAREDROP_PORT` in `.env` if port 3000 is in use.

## Sample results

The saved scenario covers 184 orders. Total distance changes from 841.974 to 473.596 km, and modeled emissions change from 81.510 to 17.303 kg CO₂e. See [the results](RESULTS.md) and [solver notes](solver/README.md).
