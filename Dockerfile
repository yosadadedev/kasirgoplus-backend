FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787

CMD ["bun", "run", "start"]

