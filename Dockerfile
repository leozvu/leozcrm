# LeozOps AI — production image (M10 deployment packaging).
#
# The app runs TypeScript directly via tsx (a devDependency), so dependencies
# are installed with --include=dev BEFORE NODE_ENV=production is set for the
# runtime. better-sqlite3/pg are optionalDependencies with prebuilt binaries —
# no compiler toolchain is needed in the image.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.json knexfile.ts ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

# Fail fast on missing env: server.ts refuses to start without AUTH_SECRET in
# production, and knexfile.ts targets PostgreSQL via DATABASE_URL / PG*.
# start:prod = migrate → seed reference data (stages only in production) → serve.
CMD ["npm", "run", "start:prod"]
