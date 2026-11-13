FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:firefox && npm run build:chromium
ENV YC_POWER_DOCKER=1
CMD ["npx", "playwright", "test"]
