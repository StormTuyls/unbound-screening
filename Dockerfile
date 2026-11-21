# De app als container, met de standalone-uitvoer van Next: geen volledige
# node_modules in de image, alleen wat de server echt laadt.
#
# NEXT_PUBLIC_APP_URL wordt bij het bouwen in de code gebakken, ook in de
# servercode, dus die komt als build-arg binnen. Al de rest (sleutels, wachtwoorden) gaat
# er pas bij het starten in, via env_file in compose.yaml.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
# De documentenmap bestaat al in de image, van de app-gebruiker en alleen voor
# hem leesbaar. Een volume dat hier gemount wordt, neemt die eigenaar en die
# rechten over bij het eerste gebruik.
ENV DOCUMENTS_DIR=/app/data/documents
RUN mkdir -p /app/data/documents && chown -R app:app /app/data && chmod -R 700 /app/data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
