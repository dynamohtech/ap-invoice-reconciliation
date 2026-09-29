# Node 24 (current Active LTS as of when this was written — check
# https://nodejs.org/en/about/previous-releases if this has moved on by the
# time you build this). The sandbox this was developed and tested in only
# had Node 22 available, so that's what actually ran the test suite during
# development — 22 and 24 are both current LTS lines and nothing here uses
# anything version-specific between them, but 24 is the one to run in
# production.
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Where uploaded invoice files land — see src/upload/storage.js. Mounted as
# a named volume in docker-compose.yml so files survive `docker compose down`.
RUN mkdir -p /app/storage/invoices

EXPOSE 3001

CMD ["sh", "-c", "node scripts/migrate.js && node src/index.js"]
