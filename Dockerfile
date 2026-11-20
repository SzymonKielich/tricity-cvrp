# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web-build
WORKDIR /build
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASEMAP=on
ENV NEXT_PUBLIC_BASEMAP=${NEXT_PUBLIC_BASEMAP}
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-trixie
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 NEXT_TELEMETRY_DISABLED=1 \
    SHAREDROP_STORAGE=/data PORT=3000 BACKEND_PORT=8123 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY backend/requirements.lock.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend /app/backend
COPY solver/*.py /app/solver/
COPY hedyla_*.csv /app/
COPY --from=web-build /build/.next/standalone /app/web/
COPY --from=web-build /build/.next/static /app/web/.next/static
EXPOSE 3000
CMD ["python", "-m", "backend.serve"]
